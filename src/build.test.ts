import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

it('builds direct Carve routes with layouts and schema-validated collection routes', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-carve-build-'))
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  const put = (path: string, value: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value) }
  try {
    symlinkSync(join(packageRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
    put('package.json', '{"type":"module"}')
    put('astro.config.mjs', `import carve from ${JSON.stringify(pathToFileURL(join(packageRoot, 'dist/index.js')).href)}; export default { vite:{build:{assetsInlineLimit:0}}, integrations: [carve({pageExtensions:true})] };`)
    put('src/layouts/Page.astro', '---\nconst { title } = Astro.props;\n---\n<html><head><title>{title}</title></head><body><slot /></body></html>')
    put('src/pages/_partial.crv', '# Imported partial\n')
    put('src/pages/partial.astro', '---\nimport html from "./_partial.crv";\n---\n<div set:html={html} />')
    put('src/pages/direct.crv', '---\ntitle: Direct\nlayout: ../layouts/Page.astro\n---\n\n# Route content\n\n|= A |= B |\n| x | < |\n^ Route caption\n\n![Route image](../content/image.png)\n\nGenerated modules end with `export default html;`\n\n![Encoded route image](../content/my%20pic.png)\n')
    put('src/content/report.crv', '---\ntitle: Report\ntags: [one, two]\npubDate: 2026-10-03\n---\n\n# Collection content\n\n|= A |= B |\n| x | < |\n^ Collection caption\n\n{{ ../fragment.crv }}\n\n![Collection image](image.png)\n\n![Encoded collection image](my%20pic.png)\n\n![Public icon](/icon.ico)\n\n![Query image](image.png?v=1)\n')
    writeFileSync(join(root, 'src/content/image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aAAAAABJRU5ErkJggg==', 'base64'))
    writeFileSync(join(root, 'src/content/my pic.png'), readFileSync(join(root, 'src/content/image.png')))
    put('src/fragment.crv', 'Included passage.\n')
    put('src/content.config.ts', `import {defineCollection, z} from 'astro:content'; import {carveLoader} from ${JSON.stringify(pathToFileURL(join(packageRoot, 'dist/index.js')).href)}; export const collections = { reports: defineCollection({loader: carveLoader({base:'src/content'}), schema: z.object({ title:z.string(), tags:z.array(z.string()), pubDate:z.date() })}) };`)
    put('src/pages/reports/[...id].astro', '---\nimport {getCollection, render} from "astro:content";\nexport async function getStaticPaths(){ return (await getCollection("reports")).map(entry => ({params:{id:entry.id},props:{entry}})); }\nconst {entry}=Astro.props; const {Content}=await render(entry);\n---\n<html><body><h1>{entry.data.title}</h1><Content /></body></html>')
    execFileSync(process.execPath, [join(packageRoot, 'node_modules/astro', JSON.parse(readFileSync(join(packageRoot, 'node_modules/astro/package.json'), 'utf8')).bin.astro), 'build', '--root', root], { cwd: root, encoding:'utf8', timeout:120000, stdio:'pipe' })
    expect(readFileSync(join(root,'dist/partial/index.html'),'utf8')).toContain('Imported partial</h1>')
    const page = readFileSync(join(root, 'dist/direct/index.html'), 'utf8')
    expect(page).toMatch(/src="\/_astro\/[^\"]+\.png"/)
    expect(page).toContain('<title>Direct</title>')
    expect(page).toContain('export default html;')
    expect(page).toContain('alt="Encoded route image"')
    expect(page).toContain('Route content</h1>')
    expect(page).toContain('colspan="2"')
    expect(page).toContain('<caption>Route caption</caption>')
    const collection = readFileSync(join(root, 'dist/reports/report/index.html'), 'utf8')
    expect(collection).toContain('Collection content</h1>')
    expect(collection).toContain('<caption>Collection caption</caption>')
    expect(collection).toContain('Included passage.')
    expect(collection).toMatch(/src="\/_astro\/[^"]+\.(png|webp)"/)
    expect(collection.match(/alt="Collection image"/g)).toHaveLength(1)
    expect(collection).not.toContain('alt=""')
    expect(collection).toContain('src="/icon.ico"')
    expect(collection).toContain('src="image.png?v=1"')
    expect(collection).not.toContain('__ASTRO_IMAGE_')
    expect(collection).toContain('alt="Encoded collection image"')
  } finally { rmSync(root, { recursive:true, force:true }) }
}, 150000)

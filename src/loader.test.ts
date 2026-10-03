import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LoaderContext } from 'astro/loaders'
import { expect, it, vi } from 'vitest'
import { carveLoader } from './loader.js'

it('reloads includes, tracks id changes and deletions, and removes old watcher listeners', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-loader-'))
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  const store = new Map<string, any>()
  const context = { config:{root:pathToFileURL(root + '/')}, store:{ get:(id:string)=>store.get(id), set:(entry:any)=>store.set(entry.id,entry), keys:()=>[...store.keys()],delete:(id:string)=>store.delete(id) }, watcher,
    parseData: vi.fn(async ({data}) => data), generateDigest: JSON.stringify,
    logger:{warn:vi.fn(),error:vi.fn()}, collection:'docs', meta:new Map() } as unknown as LoaderContext
  const change = async (event: string, path: string) => { for (const handler of watcher.listeners(event)) await handler(path) }
  try {
    writeFileSync(join(root,'page.crv'),'---\nslug: first\ntags: [one, two]\n---\n\n{{ part.txt }}\n')
    writeFileSync(join(root,'part.txt'),'First include')
    const loader = carveLoader({base:root})
    await loader.load(context)
    expect(store.get('first').data.tags).toEqual(['one','two'])
    expect(store.get('first').rendered.html).toContain('First include')
    writeFileSync(join(root,'part.txt'),'Changed include')
    await change('change',join(root,'part.txt'))
    expect(store.get('first').rendered.html).toContain('Changed include')
    rmSync(join(root,'part.txt'))
    await change('unlink',join(root,'part.txt'))
    expect(store.get('first').rendered.html).not.toContain('Changed include')
    writeFileSync(join(root,'part.txt'),'Restored include')
    await change('add',join(root,'part.txt'))
    expect(store.get('first').rendered.html).toContain('Restored include')
    writeFileSync(join(root,'page.crv'),'---\nslug: second\n---\n\nChanged page')
    await change('change',join(root,'page.crv'))
    expect(store.has('first')).toBe(false)
    expect(store.has('second')).toBe(true)
    await loader.load(context)
    expect(watcher.listenerCount('change')).toBe(1)
    rmSync(join(root,'page.crv'))
    await change('unlink',join(root,'page.crv'))
    expect(store.size).toBe(0)
  } finally { rmSync(root,{recursive:true,force:true}) }
})

it('refuses duplicate ids and propagates schema failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-loader-schema-'))
  const context = { config:{root:pathToFileURL(root + '/')},store:{set:()=>{},keys:()=>[],delete:()=>{}},generateDigest:JSON.stringify,
    parseData:async ({data}:any)=>data,logger:{warn:vi.fn()} } as unknown as LoaderContext
  try {
    writeFileSync(join(root,'one.crv'),'---\nslug: same\n---\n\nOne')
    writeFileSync(join(root,'two.crv'),'---\nslug: same\n---\n\nTwo')
    await expect(carveLoader({base:root}).load(context)).rejects.toThrow('Duplicate')
    context.parseData = async () => { throw new Error('schema rejected') }
    await expect(carveLoader({base:root,pattern:'one.crv'}).load(context)).rejects.toThrow('schema rejected')
    await expect(carveLoader({base:root,pattern:'../*.crv'}).load(context)).rejects.toThrow('within base')
  } finally { rmSync(root,{recursive:true,force:true}) }
})

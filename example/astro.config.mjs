import { defineConfig } from 'astro/config'
import carve from 'astro-carve'

// https://astro.build/config
export default defineConfig({
  integrations: [carve()],
})

import { defineConfig } from 'astro/config'
import carve from '@markup-carve/astro-carve'

// https://astro.build/config
export default defineConfig({
  integrations: [carve()],
})

import { defineCollection, z } from 'astro:content'
import { carveLoader } from '@markup-carve/astro-carve'

export const collections = {
  docs: defineCollection({
    loader: carveLoader({ base: './src/content' }),
    schema: z.object({ title: z.string() }),
  }),
}

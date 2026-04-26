import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.enum(['NISA・投資', '副業・節税', 'お得情報', 'FX・外貨']),
    tags: z.array(z.string()).default([]),
    heroImage: z.string().optional(),
    affiliate: z.boolean().default(true),
  }),
});

export const collections = { blog };

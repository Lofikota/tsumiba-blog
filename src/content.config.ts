import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    heroImage: z.string().optional(),
    affiliate: z.boolean().default(true),
    articleType: z.enum(['review', 'guide', 'comparison', 'news']).optional(),
    rating: z.number().min(1).max(5).optional(),
  }),
});

export const collections = { blog };

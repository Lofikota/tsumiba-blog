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
    draft: z.boolean().default(false),
    noindex: z.boolean().default(false),
    affiliate: z.boolean().default(true),
    articleType: z.enum(['review', 'guide', 'comparison', 'news']).optional(),
    // CMS(Sveltia)が未入力時に rating: null を書き込むため、nullはundefined扱いにする
    // （2026-06-15/07-04に計5記事で null がスキーマ違反となりビルド全体が停止した再発防止）
    rating: z.preprocess((v) => (v === null ? undefined : v), z.number().min(1).max(5).optional()),
  }),
});

export const collections = { blog };

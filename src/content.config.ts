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
    // 需要ゲート(scripts/demand-gate.mjs)の入力。正本: AI運用/戦略/検索需要ゲート設計_DEMAND-G01_2026-07-26.md §5-2
    target_kw: z.string().optional(),
    secondary_kw: z.array(z.string()).max(3).default([]),
    // CMS(Sveltia)が未入力時に rating: null を書き込むため、nullはundefined扱いにする
    // （2026-06-15/07-04に計5記事で null がスキーマ違反となりビルド全体が停止した再発防止）
    rating: z.preprocess((v) => (v === null ? undefined : v), z.number().min(1).max(5).optional()),
  }),
});

export const collections = { blog };

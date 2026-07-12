import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// noindex: true の記事をsitemapから除外する（frontmatterを直接読む。
// sitemap integrationはページURLしか受け取れないため、ここでスラッグ一覧を作る）
const noindexSlugs = fs.readdirSync('./src/content/blog')
  .filter((f) => /\.(md|mdx)$/.test(f))
  .filter((f) => /^noindex:\s*true/m.test(fs.readFileSync(`./src/content/blog/${f}`, 'utf8').match(/^---\n[\s\S]*?\n---/)?.[0] ?? ''))
  .map((f) => f.replace(/\.(md|mdx)$/, ''));

export default defineConfig({
  site: 'https://tsumiba.com',  // 母艦ドメイン（2026-06-13 Cloudflare Pages紐付け完了・Active）
  integrations: [mdx(), sitemap({
    filter: (page) => !noindexSlugs.some((slug) => page.includes(`/blog/${slug}/`)),
  })],
  output: 'static',
  // vite キャッシュを外部一時ディレクトリへ退避（マウント環境でのEPERM回避）
  vite: {
    cacheDir: path.join(os.tmpdir(), 'tsumiba-vite-cache'),
  },
});

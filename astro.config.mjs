import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  site: 'https://tsumiba.com',  // 母艦ドメイン（2026-06-13 Cloudflare Pages紐付け完了・Active）
  integrations: [mdx(), sitemap()],
  output: 'static',
  // vite キャッシュを外部一時ディレクトリへ退避（マウント環境でのEPERM回避）
  vite: {
    cacheDir: path.join(os.tmpdir(), 'tsumiba-vite-cache'),
  },
});

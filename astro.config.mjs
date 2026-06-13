import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://tsumiba.com',  // 母艦ドメイン（2026-06-13 Cloudflare Pages紐付け完了・Active）
  integrations: [mdx(), sitemap()],
  output: 'static',
});

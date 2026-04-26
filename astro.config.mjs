import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://ren-money.com',  // 本番ドメイン確定
  integrations: [mdx(), sitemap()],
  output: 'static',
});

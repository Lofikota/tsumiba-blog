import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', (e) => !e.data.draft);
  return rss({
    title: 'tsumiba',
    description: 'DMM FX・JFX・FXTFなど国内FX口座の条件・スプレッド・リスクを、少額で始めたい初心者向けに比較するFX口座比較メディア',
    site: context.site!,
    items: posts
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map(post => ({
        title: post.data.title,
        pubDate: post.data.pubDate,
        description: post.data.description,
        link: `/blog/${post.id}/`,
      })),
  });
}

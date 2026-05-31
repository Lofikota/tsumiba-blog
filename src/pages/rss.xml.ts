import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', (e) => !e.data.draft);
  return rss({
    title: '田中蓮のFX口座比較ブログ',
    description: 'DMM FX・JFX・FXTFなど、会社員目線でFX口座の条件・スプレッド・リスクを比較する田中蓮のFX特化ブログ',
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

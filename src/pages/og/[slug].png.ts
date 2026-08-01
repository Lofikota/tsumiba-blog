import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import sharp from 'sharp';
import { GET as renderSvg } from './[slug].svg';

export async function getStaticPaths() {
  const posts = (await getCollection('blog')).filter((post) => !post.data.draft);
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

/**
 * Xを含むSNSクローラー向けに、既存の決定論的OGカードをPNGで配信する。
 * SVG版を正本として再利用するため、タイトルやブランド表現が二重管理にならない。
 */
export const GET: APIRoute = async (context) => {
  const svgResponse = await renderSvg(context);
  const svg = await svgResponse.text();
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};

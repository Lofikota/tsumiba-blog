import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const posts = (await getCollection('blog')).filter(p => !p.data.draft);
  return posts.map(post => ({ params: { slug: post.id }, props: { post } }));
}

export const GET: APIRoute = ({ props }) => {
  const { post } = props as any;
  const title: string = post.data.title ?? '';
  const category: string = post.data.category ?? '';

  const catColor: Record<string, string> = {
    'NISA・投資': '#1B3A5B',
    '副業・節税': '#16A34A',
    'お得情報':   '#D97706',
    'FX・外貨':   '#E0A458',
  };
  const accent = catColor[category] ?? '#1B3A5B';

  // タイトルを24文字で折り返す
  const words = title.split('');
  const lines: string[] = [];
  let cur = '';
  for (const ch of words) {
    cur += ch;
    if (cur.length >= 24) { lines.push(cur); cur = ''; }
  }
  if (cur) lines.push(cur);
  const titleLines = lines.slice(0, 2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#14304D"/>
      <stop offset="100%" stop-color="#1B3A5B"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
    <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.05)"/>
  </pattern>
  <rect width="1200" height="630" fill="url(#dots)"/>

  <rect x="80" y="80" width="1040" height="470" rx="20" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>

  <!-- カテゴリバッジ -->
  <rect x="140" y="140" width="${category.length * 22 + 40}" height="46" rx="23" fill="${accent}"/>
  <text x="${140 + (category.length * 22 + 40) / 2}" y="170" font-family="'Noto Sans JP', sans-serif" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">${category}</text>

  <!-- タイトル1行目 -->
  ${titleLines[0] ? `<text x="140" y="280" font-family="'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif" font-size="52" font-weight="900" fill="#fff">${titleLines[0]}</text>` : ''}
  <!-- タイトル2行目 -->
  ${titleLines[1] ? `<text x="140" y="350" font-family="'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif" font-size="52" font-weight="900" fill="#fff">${titleLines[1]}</text>` : ''}

  <!-- 区切り線 -->
  <rect x="140" y="390" width="80" height="4" rx="2" fill="#FBBF24"/>

  <!-- サイト名 -->
  <text x="140" y="460" font-family="'Noto Sans JP', sans-serif" font-size="26" font-weight="700" fill="rgba(255,255,255,0.75)">tsumiba</text>
  <text x="1060" y="460" font-family="sans-serif" font-size="20" fill="rgba(255,255,255,0.45)" text-anchor="end">ren-money.com</text>

  <!-- ロゴ -->
  <g transform="translate(140, 490)">
    <rect x="0"  y="12" width="8"  height="18" rx="1" fill="rgba(255,255,255,0.6)"/>
    <rect x="12" y="6"  width="8"  height="24" rx="1" fill="rgba(255,255,255,0.6)"/>
    <rect x="24" y="0"  width="8"  height="30" rx="1" fill="rgba(255,255,255,0.6)"/>
    <path d="M3 12 L15 6 L27 2 L44 -4" stroke="#FBBF24" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  </g>
  <text x="200" y="513" font-family="sans-serif" font-size="18" fill="rgba(255,255,255,0.5)">会社員目線でFX口座を比較する32歳のリアル</text>
</svg>`;

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
};

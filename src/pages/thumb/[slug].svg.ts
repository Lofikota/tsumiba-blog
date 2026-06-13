import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const posts = (await getCollection('blog')).filter((p) => !p.data.draft);
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = ({ props }) => {
  const { post } = props as any;
  const title: string = post.data.title ?? '';
  const category: string = post.data.category ?? '';

  // タイトルを15文字で折り返し、最大3行
  const chars = [...title];
  const lines: string[] = [];
  let cur = '';
  for (const ch of chars) {
    cur += ch;
    if ([...cur].length >= 15) {
      lines.push(cur);
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  let titleLines = lines.slice(0, 3);
  if (lines.length > 3) {
    titleLines[2] = [...titleLines[2]].slice(0, 14).join('') + '…';
  }

  const lineY = 268;
  const lineH = 80;
  const titleSvg = titleLines
    .map(
      (ln, i) =>
        `<text x="72" y="${lineY + i * lineH}" font-family="'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" font-size="58" font-weight="700" fill="#1B3A5B">${esc(ln)}</text>`
    )
    .join('');
  const dividerY = lineY + titleLines.length * lineH - 36;
  const catW = [...category].length * 28 + 40;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" fill="#ffffff"/>
  <rect x="20" y="20" width="1160" height="635" rx="22" fill="#ffffff" stroke="#E5E7EB" stroke-width="2"/>

  <rect x="72" y="84" width="${catW}" height="50" rx="10" fill="#1B3A5B"/>
  <text x="${72 + catW / 2}" y="117" font-family="'Noto Sans JP',sans-serif" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(category)}</text>

  ${titleSvg}
  <rect x="74" y="${dividerY}" width="88" height="7" rx="3" fill="#E0A458"/>

  <g transform="translate(940,300)" opacity="0.9">
    <rect x="0"   y="120" width="44" height="40" rx="4" fill="#1B3A5B"/>
    <rect x="56"  y="86"  width="44" height="74" rx="4" fill="#1B3A5B"/>
    <rect x="112" y="44"  width="44" height="116" rx="4" fill="#274C73"/>
    <polyline points="14,118 70,84 126,46 170,16" fill="none" stroke="#E0A458" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="170" cy="16" r="9" fill="#E0A458"/>
  </g>

  <g transform="translate(72,566)">
    <rect x="0"  y="10" width="9"  height="20" rx="1.5" fill="#1B3A5B"/>
    <rect x="13" y="4"  width="9"  height="26" rx="1.5" fill="#1B3A5B"/>
    <rect x="26" y="-2" width="9"  height="32" rx="1.5" fill="#1B3A5B"/>
  </g>
  <text x="124" y="592" font-family="'Noto Sans JP',sans-serif" font-size="30" font-weight="700" fill="#1B3A5B">tsumiba</text>
  <text x="252" y="592" font-family="'Noto Sans JP',sans-serif" font-size="22" font-weight="500" fill="#6b7280">｜FX</text>
</svg>`;

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
};

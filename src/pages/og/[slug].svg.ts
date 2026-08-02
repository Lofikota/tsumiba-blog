import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function wrapTitle(title: string, maxChars = 17, maxLines = 3) {
  const chars = [...title];
  const lines: string[] = [];

  while (chars.length > 0 && lines.length < maxLines) {
    lines.push(chars.splice(0, maxChars).join(''));
  }
  if (chars.length > 0) {
    lines[maxLines - 1] = [...lines[maxLines - 1]].slice(0, maxChars - 1).join('') + '…';
  }
  return lines;
}

export async function getStaticPaths() {
  const posts = (await getCollection('blog')).filter(p => !p.data.draft);
  return posts.map(post => ({ params: { slug: post.id }, props: { post } }));
}

export const GET: APIRoute = ({ props }) => {
  const { post } = props as any;
  const title: string = post.data.title ?? '';
  const category: string = post.data.category ?? '';

  // ブランド正本の4色（白・ネイビー・琥珀・グレー）だけで組む。
  // カテゴリごとに色を変えると1枚あたりの色数がブランド上限を超えるため、
  // 琥珀はカード内で「カテゴリバッジ1箇所」だけに使う。
  const ACCENT = '#E0A458'; // 琥珀
  const NAVY = '#1B3A5B';

  // Xカードの安全領域に収める。長いタイトルは3行目を省略記号で閉じる。
  const titleLines = wrapTitle(title);
  const titleSvg = titleLines
    .map(
      (line, index) =>
        `<text x="140" y="${260 + index * 64}" font-family="'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif" font-size="48" font-weight="900" fill="#fff">${escapeXml(line)}</text>`,
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${NAVY}"/>
  <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
    <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.05)"/>
  </pattern>
  <rect width="1200" height="630" fill="url(#dots)"/>

  <rect x="80" y="80" width="1040" height="470" rx="20" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>

  <!-- カテゴリバッジ -->
  <rect x="140" y="140" width="${category.length * 22 + 40}" height="46" rx="23" fill="${ACCENT}"/>
  <text x="${140 + (category.length * 22 + 40) / 2}" y="170" font-family="'Noto Sans JP', sans-serif" font-size="22" font-weight="700" fill="${NAVY}" text-anchor="middle">${escapeXml(category)}</text>

  <!-- タイトル（最大3行） -->
  ${titleSvg}

  <!-- 区切り線 -->
  <rect x="140" y="430" width="80" height="4" rx="2" fill="rgba(255,255,255,0.35)"/>

  <!-- サイト名 -->
  <text x="140" y="460" font-family="'Noto Sans JP', sans-serif" font-size="26" font-weight="700" fill="rgba(255,255,255,0.75)">tsumiba</text>
  <text x="1060" y="460" font-family="sans-serif" font-size="20" fill="rgba(255,255,255,0.45)" text-anchor="end">tsumiba.com</text>

  <!-- ロゴ -->
  <g transform="translate(140, 490)">
    <rect x="0"  y="12" width="8"  height="18" rx="1" fill="rgba(255,255,255,0.6)"/>
    <rect x="12" y="6"  width="8"  height="24" rx="1" fill="rgba(255,255,255,0.6)"/>
    <rect x="24" y="0"  width="8"  height="30" rx="1" fill="rgba(255,255,255,0.6)"/>
    <path d="M3 12 L15 6 L27 2 L44 -4" stroke="rgba(255,255,255,0.6)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  </g>
  <text x="200" y="513" font-family="sans-serif" font-size="18" fill="rgba(255,255,255,0.5)">国内FXのコスト・約定力を毎週検証する編集部</text>
</svg>`;

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
};

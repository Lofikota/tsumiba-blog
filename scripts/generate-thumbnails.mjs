/**
 * 全記事分のSVGサムネイル・OG画像を生成する
 * - public/thumbnails/{slug}.svg  (96×64  ブログ一覧カード用)
 * - public/og/{slug}.svg          (1200×630 OGPメタタグ用)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const THUMB_DIR = path.join(ROOT, 'public/thumbnails');
const OG_DIR = path.join(ROOT, 'public/og');

// カテゴリ別デザイン定義
const CATEGORY_STYLES = {
  'FX・外貨':      { bg: '#EA580C', accent: '#FB923C', emoji: '💱', label: 'FX・外貨' },
  'NISA・投資':    { bg: '#1D4ED8', accent: '#3B82F6', emoji: '📈', label: 'NISA・投資' },
  '副業・節税':    { bg: '#047857', accent: '#10B981', emoji: '💰', label: '副業・節税' },
  'お得情報':      { bg: '#B45309', accent: '#F59E0B', emoji: '🎁', label: 'お得情報' },
  '保険':          { bg: '#6D28D9', accent: '#8B5CF6', emoji: '🛡️', label: '保険' },
  '投資・資産運用':{ bg: '#0E7490', accent: '#06B6D4', emoji: '📊', label: '投資・資産運用' },
  'クレジットカード':{ bg: '#BE185D', accent: '#EC4899', emoji: '💳', label: 'クレカ' },
  '家計・節約':    { bg: '#0F766E', accent: '#14B8A6', emoji: '🏠', label: '家計・節約' },
};
const DEFAULT_STYLE = { bg: '#475569', accent: '#64748B', emoji: '📝', label: '記事' };

// frontmatterから値を取り出す
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const block = match[1];
  const get = (key) => {
    const m = block.match(new RegExp(`^${key}:\\s*"([^"]*)"`, 'm'));
    return m ? m[1] : null;
  };
  return { title: get('title'), category: get('category') };
}

// タイトルを指定文字数で折り返す
function wrapText(text, maxLen) {
  const lines = [];
  let line = '';
  for (const char of text) {
    line += char;
    if (line.length >= maxLen) {
      lines.push(line);
      line = '';
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2); // 最大2行
}

function makeThumbnail(slug, style) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64">
  <rect width="96" height="64" rx="6" fill="${style.bg}"/>
  <rect x="4" y="4" width="88" height="56" rx="4" fill="${style.accent}"/>
  <text x="48" y="22" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="900" font-size="18" fill="#FFFFFF" text-anchor="middle">${style.emoji}</text>
  <text x="48" y="40" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="8" fill="#FFFFFF" text-anchor="middle">${style.label}</text>
  <text x="48" y="52" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="500" font-size="6.5" fill="rgba(255,255,255,0.8)" text-anchor="middle">ren-money.com</text>
</svg>`;
}

function makeOgImage(title, style) {
  const lines = wrapText(title, 22);
  const line1 = escXml(lines[0] ?? '');
  const line2 = escXml(lines[1] ?? '');
  const titleY1 = lines.length > 1 ? 350 : 380;
  const titleY2 = titleY1 + 80;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${style.bg}"/>
  <!-- 右側アクセント -->
  <rect x="900" y="0" width="300" height="630" fill="${style.accent}" opacity="0.4"/>
  <circle cx="1050" cy="315" r="220" fill="${style.accent}" opacity="0.25"/>
  <!-- ヘッダーライン -->
  <rect x="0" y="0" width="1200" height="8" fill="${style.accent}"/>
  <!-- 絵文字 -->
  <text x="140" y="250" font-family="'Segoe UI Emoji',sans-serif" font-size="120" text-anchor="middle">${style.emoji}</text>
  <!-- カテゴリバッジ -->
  <rect x="60" y="290" width="${style.label.length * 22 + 40}" height="48" rx="24" fill="rgba(255,255,255,0.18)"/>
  <text x="${style.label.length * 11 + 80}" y="323" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="26" fill="#FFFFFF" text-anchor="middle">${style.label}</text>
  <!-- タイトル -->
  <text x="60" y="${titleY1}" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="900" font-size="64" fill="#FFFFFF">${line1}</text>
  ${line2 ? `<text x="60" y="${titleY2}" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="900" font-size="64" fill="#FFFFFF">${line2}</text>` : ''}
  <!-- フッター -->
  <text x="60" y="580" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="500" font-size="28" fill="rgba(255,255,255,0.65)">田中蓮のマネーブログ | ren-money.com</text>
</svg>`;
}

function escXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ディレクトリ準備
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(OG_DIR, { recursive: true });

const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));
let ok = 0;

for (const file of files) {
  const slug = file.replace(/\.mdx$/, '');
  const content = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
  const { title, category } = parseFrontmatter(content);
  const style = CATEGORY_STYLES[category] ?? DEFAULT_STYLE;

  fs.writeFileSync(path.join(THUMB_DIR, `${slug}.svg`), makeThumbnail(slug, style));
  fs.writeFileSync(path.join(OG_DIR, `${slug}.svg`), makeOgImage(title ?? slug, style));
  console.log(`✓ ${slug}  [${category ?? '不明'}]`);
  ok++;
}

console.log(`\n完了: ${ok}記事分のSVGを生成しました`);
console.log(`  thumbnails/ → ${THUMB_DIR}`);
console.log(`  og/         → ${OG_DIR}`);

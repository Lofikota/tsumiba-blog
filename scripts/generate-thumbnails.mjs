/**
 * 全記事分のSVGサムネイルを生成する
 * - public/thumbnails/{slug}.svg  (96×64  ブログ一覧カード用)
 *
 * OG画像(1200×630)はここでは作らない。src/pages/og/[slug].svg.ts が正本で、
 * 同 [slug].png.ts が sharp でPNG化してSNSクローラーへ配信する。
 * public/og/ に同名の静的ファイルを置くとルートより優先され、
 * 旧配色のカードが本番で配信される（2026-08-02 IMG-C02 で是正）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const THUMB_DIR = path.join(ROOT, 'public/thumbnails');

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

function makeThumbnail(slug, style) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64">
  <rect width="96" height="64" rx="6" fill="${style.bg}"/>
  <rect x="4" y="4" width="88" height="56" rx="4" fill="${style.accent}"/>
  <text x="48" y="22" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="900" font-size="18" fill="#FFFFFF" text-anchor="middle">${style.emoji}</text>
  <text x="48" y="40" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="8" fill="#FFFFFF" text-anchor="middle">${style.label}</text>
  <text x="48" y="52" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="500" font-size="6.5" fill="rgba(255,255,255,0.8)" text-anchor="middle">tsumiba.com</text>
</svg>`;
}

// ディレクトリ準備
fs.mkdirSync(THUMB_DIR, { recursive: true });

const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));
let ok = 0;

for (const file of files) {
  const slug = file.replace(/\.mdx$/, '');
  const content = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
  const { category } = parseFrontmatter(content);
  const style = CATEGORY_STYLES[category] ?? DEFAULT_STYLE;

  fs.writeFileSync(path.join(THUMB_DIR, `${slug}.svg`), makeThumbnail(slug, style));
  console.log(`✓ ${slug}  [${category ?? '不明'}]`);
  ok++;
}

console.log(`\n完了: ${ok}記事分のサムネイルSVGを生成しました`);
console.log(`  thumbnails/ → ${THUMB_DIR}`);

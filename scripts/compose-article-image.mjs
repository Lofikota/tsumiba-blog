#!/usr/bin/env node
/**
 * imagegenで作った文字なしのベース画像へ、記事タイトル・カテゴリ・媒体名を
 * 決定論的に合成して最終PNGを作る。
 *
 * Usage:
 *   node scripts/compose-article-image.mjs --slug fx-kouza-hikaku
 *
 * Input:  public/images/articles/base/{slug}.png
 * Output: public/images/articles/{slug}.png (1200×675)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const BASE_DIR = path.join(ROOT, 'public/images/articles/base');
const OUTPUT_DIR = path.join(ROOT, 'public/images/articles');

const WIDTH = 1200;
const HEIGHT = 675;
const FONT_FAMILY = [
  'Noto Sans CJK JP',
  'Noto Sans JP',
  'Hiragino Sans',
  'Hiragino Kaku Gothic ProN',
  'Yu Gothic',
  'Meiryo',
  'sans-serif',
].map((font) => font.includes(' ') ? `'${font}'` : font).join(',');

function escXml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const getString = (key) => {
    const quoted = match[1].match(new RegExp(`^${key}:\\s*"([^"]*)"\\s*$`, 'm'));
    if (quoted) return quoted[1];
    const plain = match[1].match(new RegExp(`^${key}:\\s*([^\\n]+)\\s*$`, 'm'));
    return plain ? plain[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return {
    title: getString('title'),
    category: getString('category'),
  };
}

function wrapTitle(title, maxChars = 18, maxLines = 3) {
  const chars = [...title];
  const lines = [];
  let current = '';

  for (const char of chars) {
    current += char;
    if ([...current].length >= maxChars) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);

  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    clipped[maxLines - 1] = [...clipped[maxLines - 1]].slice(0, maxChars - 1).join('') + '…';
  }
  return clipped;
}

function overlaySvg({ title, category }) {
  const lines = wrapTitle(title);
  const lineHeight = 68;
  const startY = lines.length === 3 ? 250 : 285;
  const titleSvg = lines.map((line, index) => (
    `<text x="72" y="${startY + index * lineHeight}" font-family="${FONT_FAMILY}" font-size="54" font-weight="900" fill="#FFFFFF">${escXml(line)}</text>`
  )).join('');
  const badgeWidth = Math.max(150, [...category].length * 30 + 44);

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0B1F33" stop-opacity="0.94"/>
        <stop offset="58%" stop-color="#0B1F33" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="#0B1F33" stop-opacity="0.12"/>
      </linearGradient>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="45%" stop-color="#0B1F33" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0B1F33" stop-opacity="0.72"/>
      </linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bottom)"/>
    <rect x="72" y="92" width="${badgeWidth}" height="48" rx="10" fill="#E0A458"/>
    <text x="${72 + badgeWidth / 2}" y="124" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="25" font-weight="700" fill="#1B3A5B">${escXml(category)}</text>
    ${titleSvg}
    <rect x="72" y="536" width="76" height="6" rx="3" fill="#E0A458"/>
    <g transform="translate(72,574)">
      <rect x="0" y="20" width="34" height="12" rx="2" fill="#FFFFFF"/>
      <rect x="5" y="7" width="24" height="10" rx="2" fill="#FFFFFF"/>
      <rect x="10" y="-4" width="14" height="8" rx="2" fill="#FFFFFF"/>
    </g>
    <text x="122" y="606" font-family="${FONT_FAMILY}" font-size="28" font-weight="700" fill="#FFFFFF">tsumiba 編集部</text>
    <text x="1128" y="606" text-anchor="end" font-family="sans-serif" font-size="20" fill="#FFFFFF" fill-opacity="0.76">tsumiba.com</text>
  </svg>`);
}

export async function composeArticleImage({ basePath, outputPath, title, category = 'FX・外貨' }) {
  if (!fs.existsSync(basePath)) {
    throw new Error(`ベース画像がありません: ${basePath}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await sharp(basePath)
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlaySvg({ title, category }), top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function main() {
  const args = process.argv.slice(2);
  const slugIndex = args.indexOf('--slug');
  const slug = slugIndex >= 0 ? args[slugIndex + 1] : null;
  if (!slug) {
    console.error('Usage: node scripts/compose-article-image.mjs --slug <slug>');
    process.exit(1);
  }

  const mdxPath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(mdxPath)) {
    console.error(`記事がありません: ${mdxPath}`);
    process.exit(1);
  }
  const data = parseFrontmatter(fs.readFileSync(mdxPath, 'utf-8'));
  const basePath = path.join(BASE_DIR, `${slug}.png`);
  const outputPath = path.join(OUTPUT_DIR, `${slug}.png`);
  await composeArticleImage({
    basePath,
    outputPath,
    title: data.title || slug,
    category: data.category || 'FX・外貨',
  });
  console.log(`composed: ${path.relative(ROOT, outputPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

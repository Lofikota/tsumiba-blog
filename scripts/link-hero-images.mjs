#!/usr/bin/env node
/**
 * public/images/articles/{slug}.png が既に存在するのに frontmatter へ heroImage を
 * 書いていない記事を洗い出し、接続する（生成はしない）。
 *
 * 画像は作られているのに記事が参照しておらず、一覧サムネもOGPもSVGフォールバックの
 * ままだった状態（IMG-C01）を是正するための棚卸し＋一括接続スクリプト。
 *
 * Usage:
 *   node scripts/link-hero-images.mjs                      # 棚卸しのみ（既定・書き込まない）
 *   node scripts/link-hero-images.mjs --apply              # ①群へ heroImage を追記
 *   node scripts/link-hero-images.mjs --apply --exclude a,b # 検品NGのslugを接続対象から外す
 *
 * 分類:
 *   ① linkable : 画像あり × heroImage無し → 接続対象
 *   ② missing  : 画像なし              → 生成要否はTAKT判断（本スクリプトは生成しない）
 *   ③ linked   : heroImage設定済み
 *   orphan     : 画像はあるが対応する記事が無い
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const IMAGE_DIR = path.join(ROOT, 'public/images/articles');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const excludeArg = args.find((a) => a.startsWith('--exclude'));
const excluded = new Set(
  (excludeArg?.includes('=')
    ? excludeArg.split('=')[1]
    : excludeArg
      ? args[args.indexOf(excludeArg) + 1]
      : ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// generate-article-images.mjs と同じ読み方に合わせる（frontmatterは素朴なkey: value）
function readFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { block: '', bodyStart: 0, get: () => null };
  const block = match[1];
  const get = (key) => {
    const quoted = block.match(new RegExp(`^${key}:\\s*"([^"]*)"\\s*$`, 'm'));
    if (quoted) return quoted[1];
    const plain = block.match(new RegExp(`^${key}:\\s*([^\\n]+)\\s*$`, 'm'));
    return plain ? plain[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return { block, bodyStart: match[0].length, get };
}

function writeHeroImage(content, imagePath) {
  const { block, bodyStart } = readFrontmatter(content);
  if (!block) return content;
  const nextBlock = block.match(/^heroImage:/m)
    ? block.replace(/^heroImage:.*$/m, `heroImage: "${imagePath}"`)
    : `${block}\nheroImage: "${imagePath}"`;
  return `---\n${nextBlock}\n---${content.slice(bodyStart)}`;
}

const imageFiles = fs.existsSync(IMAGE_DIR)
  ? fs.readdirSync(IMAGE_DIR).filter((f) => f.endsWith('.png'))
  : [];
const imageSlugs = new Set(imageFiles.map((f) => f.replace(/\.png$/, '')));

const articles = fs
  .readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.mdx'))
  .sort()
  .map((file) => {
    const slug = file.replace(/\.mdx$/, '');
    const filePath = path.join(BLOG_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = readFrontmatter(content);
    return {
      slug,
      filePath,
      content,
      hero: fm.get('heroImage'),
      title: fm.get('title'),
      category: fm.get('category'),
      draft: fm.get('draft') === 'true',
      hasImage: imageSlugs.has(slug),
    };
  });

// heroImageが /og/ や /thumbnails/ を指している場合は「未接続」扱い（SVGフォールバック）
const isRealHero = (hero) => Boolean(hero) && hero.startsWith('/images/articles/');

const linked = articles.filter((a) => isRealHero(a.hero));
const linkable = articles.filter((a) => !isRealHero(a.hero) && a.hasImage);
const missing = articles.filter((a) => !isRealHero(a.hero) && !a.hasImage);
const orphans = [...imageSlugs].filter((s) => !articles.some((a) => a.slug === s)).sort();

const fmt = (a) => `  ${a.slug}${a.draft ? ' [draft]' : ''}  (${a.category ?? 'カテゴリ未設定'})`;

console.log('=== heroImage 接続 棚卸し ===');
console.log(`記事: ${articles.length}本 / 画像: ${imageFiles.length}枚\n`);
console.log(`① 画像あり × heroImage無し（接続対象）: ${linkable.length}本`);
linkable.forEach((a) => console.log(fmt(a)));
console.log(`\n② 画像なし（生成要否はTAKT判断）: ${missing.length}本`);
missing.forEach((a) => console.log(fmt(a)));
console.log(`\n③ heroImage設定済み: ${linked.length}本`);
linked.forEach((a) => console.log(fmt(a)));
console.log(`\n孤児画像（対応記事なし）: ${orphans.length}枚`);
orphans.forEach((s) => console.log(`  ${s}.png`));

if (!apply) {
  console.log('\n（棚卸しのみ。接続するには --apply を付ける）');
  process.exit(0);
}

const targets = linkable.filter((a) => !excluded.has(a.slug));
const skipped = linkable.filter((a) => excluded.has(a.slug));

for (const a of targets) {
  const imagePath = `/images/articles/${a.slug}.png`;
  fs.writeFileSync(a.filePath, writeHeroImage(a.content, imagePath), 'utf-8');
  console.log(`✅ ${a.slug} → ${imagePath}`);
}
if (skipped.length) {
  console.log(`\n⏭  検品NGで除外: ${skipped.length}本`);
  skipped.forEach((a) => console.log(`  ${a.slug}`));
}
console.log(`\n接続完了: ${targets.length}本 / 除外: ${skipped.length}本`);

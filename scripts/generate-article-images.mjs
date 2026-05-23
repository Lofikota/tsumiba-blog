#!/usr/bin/env node
/**
 * OpenAI Image APIで記事用のヒーロー画像を生成し、MDXのheroImageへ反映する。
 *
 * Usage:
 *   node scripts/generate-article-images.mjs --slug hoken-soudan-muryou-hikaku
 *   node scripts/generate-article-images.mjs --all --limit 5
 *   node scripts/generate-article-images.mjs --slug fx-kouza-hikaku --dry-run
 *
 * Required:
 *   OPENAI_API_KEY
 *
 * Optional:
 *   OPENAI_IMAGE_MODEL=gpt-image-1.5
 *   OPENAI_IMAGE_SIZE=1536x1024
 *   OPENAI_IMAGE_QUALITY=high
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const IMAGE_DIR = path.join(ROOT, 'public/images/articles');

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const hasArg = (name) => args.includes(name);

const slugArg = getArg('--slug');
const dryRun = hasArg('--dry-run');
const overwrite = hasArg('--overwrite');
const allMode = hasArg('--all');
const limit = Number(getArg('--limit') ?? 999);

const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
const size = process.env.OPENAI_IMAGE_SIZE || '1536x1024';
const quality = process.env.OPENAI_IMAGE_QUALITY || 'high';

if (!slugArg && !allMode) {
  console.error('Usage: node scripts/generate-article-images.mjs --slug <slug> または --all');
  process.exit(1);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, block: '', bodyStart: 0 };
  const block = match[1];
  const getString = (key) => {
    const quoted = block.match(new RegExp(`^${key}:\\s*"([^"]*)"\\s*$`, 'm'));
    if (quoted) return quoted[1];
    const plain = block.match(new RegExp(`^${key}:\\s*([^\\n]+)\\s*$`, 'm'));
    return plain ? plain[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return {
    data: {
      title: getString('title'),
      description: getString('description'),
      category: getString('category'),
      heroImage: getString('heroImage'),
    },
    block,
    bodyStart: match[0].length,
  };
}

function writeHeroImage(content, imagePath) {
  const parsed = parseFrontmatter(content);
  if (!parsed.block) return content;

  const nextBlock = parsed.block.match(/^heroImage:/m)
    ? parsed.block.replace(/^heroImage:.*$/m, `heroImage: "${imagePath}"`)
    : `${parsed.block}\nheroImage: "${imagePath}"`;

  return `---\n${nextBlock}\n---${content.slice(parsed.bodyStart)}`;
}

function listTargets() {
  const files = fs.readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith('.mdx'))
    .sort();

  const selected = slugArg ? [`${slugArg}.mdx`] : files;
  return selected
    .filter((file) => fs.existsSync(path.join(BLOG_DIR, file)))
    .map((file) => {
      const slug = file.replace(/\.mdx$/, '');
      const filePath = path.join(BLOG_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data } = parseFrontmatter(content);
      return { slug, filePath, content, data };
    })
    .filter((item) => overwrite || !item.data.heroImage || item.data.heroImage.startsWith('/og/') || item.data.heroImage.startsWith('/thumbnails/'))
    .slice(0, limit);
}

function promptForArticle({ slug, data }) {
  const category = data.category || '金融';
  const title = data.title || slug;
  const description = data.description || '';

  const categoryScene = {
    '保険': 'a calm insurance and household budget consultation scene at a bright Japanese dining table, documents neatly arranged, warm trustworthy atmosphere',
    'FX・外貨': 'a focused Japanese office worker reviewing currency charts and risk notes on a laptop, modern desk, disciplined and cautious mood',
    'NISA・投資': 'a Japanese office worker planning long-term investing with a notebook, tablet, and simple chart visuals, calm morning light',
    '投資・資産運用': 'a clean personal finance planning desk with portfolio notes, tablet charts, and coffee, realistic Japanese apartment setting',
    '副業・節税': 'a Japanese office worker organizing receipts, tax forms, and a laptop after work, practical side-business atmosphere',
    'クレジットカード': 'a tidy desk with credit cards, point statements, smartphone payment screen, and budgeting notebook, premium but realistic',
    'お得情報': 'a clean household budgeting scene with smartphone coupons, cards, and a notebook, practical saving mood',
    '家計・節約': 'a Japanese household budgeting table with bills, notebook, calculator, and tea, reassuring everyday atmosphere',
  }[category] || 'a realistic Japanese personal finance blog image with a laptop, notebook, documents, and warm natural light';

  return [
    'Use case: photorealistic-natural',
    'Asset type: 16:9 hero image for a Japanese personal finance affiliate blog article',
    `Article title for context: ${title}`,
    `Article category: ${category}`,
    description ? `Article description: ${description}` : '',
    `Scene/backdrop: ${categoryScene}.`,
    'Subject: realistic Japanese 30s office worker or hands-only composition depending on what feels natural; no identifiable celebrity; no brand logos.',
    'Composition: editorial blog cover, strong central visual, clean negative space near the top-left for page layout, professional WordPress-style article thumbnail.',
    'Style: photorealistic, trustworthy, warm daylight, premium but not luxury, practical household finance mood, high detail, natural colors.',
    'Avoid: in-image text, fake UI labels, brand logos, watermarks, exaggerated money piles, gambling feeling, get-rich-quick mood, medical/legal document claims.',
    'Output: landscape image, no text.'
  ].filter(Boolean).join('\n');
}

async function generateImage(prompt, outputPath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY がありません。1Password経由の op run かローカル環境変数で渡してください。');
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      n: 1,
      output_format: 'png',
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Image API error: ${message}`);
  }

  const first = payload.data?.[0];
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (first?.b64_json) {
    fs.writeFileSync(outputPath, Buffer.from(first.b64_json, 'base64'));
    return;
  }

  if (first?.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) throw new Error(`画像URLの取得に失敗しました: ${imageResponse.status}`);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return;
  }

  throw new Error('Image APIのレスポンスに画像データがありません。');
}

const targets = listTargets();
if (targets.length === 0) {
  console.log('対象記事がありません。heroImageなしの記事がないか、slugを確認してください。');
  process.exit(0);
}

console.log(`対象: ${targets.length}件 / model=${model} / size=${size} / quality=${quality}`);

for (const target of targets) {
  const imagePath = `/images/articles/${target.slug}.png`;
  const outputPath = path.join(ROOT, 'public', imagePath);
  const prompt = promptForArticle(target);

  if (dryRun) {
    console.log(`\n--- ${target.slug} ---\n${prompt}\n=> ${imagePath}`);
    continue;
  }

  if (fs.existsSync(outputPath) && !overwrite) {
    console.log(`skip: ${target.slug} 既存画像あり (${imagePath})`);
  } else {
    console.log(`generate: ${target.slug}`);
    await generateImage(prompt, outputPath);
  }

  const nextContent = writeHeroImage(target.content, imagePath);
  fs.writeFileSync(target.filePath, nextContent, 'utf-8');
  console.log(`updated: ${path.relative(ROOT, target.filePath)} -> ${imagePath}`);
}

console.log('\n完了');

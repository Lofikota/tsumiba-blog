#!/usr/bin/env node
/**
 * OpenAI Image APIで記事用のヒーロー画像を生成し、MDXのheroImageへ反映する。
 *
 * Usage:
 *   node scripts/generate-article-images.mjs --slug fx-kouza-hikaku
 *   node scripts/generate-article-images.mjs --all --limit 5
 *   node scripts/generate-article-images.mjs --slug fx-kouza-hikaku --dry-run
 *   node scripts/generate-article-images.mjs --all --all-categories
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
const allCategories = hasArg('--all-categories');
const onlyNonFx = hasArg('--only-non-fx');
const limit = Number(getArg('--limit') ?? 999);

const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
const size = process.env.OPENAI_IMAGE_SIZE || '1536x1024';
const quality = process.env.OPENAI_IMAGE_QUALITY || 'high';

if (!slugArg && !allMode) {
  console.error('Usage: node scripts/generate-article-images.mjs --slug <slug> または --all');
  process.exit(1);
}

const FX_SLUGS = new Set([
  'fx-kouza-hikaku',
  'dmm-fx-review',
  'jfx-review',
  'fxtf-review',
  'matsui-fx-review',
  'fx-shoshinsha-guide',
  'fx-small-start-guide',
  'fx-leverage-risk-guide',
  'fx-kakuteishinkoku-guide',
  'fx-company-barenai',
  'fx-yametoke-reason',
]);

function isFxArticle(item) {
  return item.data.category === 'FX・外貨' || FX_SLUGS.has(item.slug) || item.slug.includes('fx');
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
      pubDate: getString('pubDate'),
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
    .filter((item) => slugArg || allCategories || isFxArticle(item))
    .filter((item) => !onlyNonFx || !isFxArticle(item))
    .filter((item) => {
      if (overwrite) return true;
      if (!item.data.heroImage) return true;
      if (item.data.heroImage.startsWith('/og/') || item.data.heroImage.startsWith('/thumbnails/')) return true;
      // heroImageが設定済みでも実ファイルがなければ生成対象にする
      return !fs.existsSync(path.join(ROOT, 'public', item.data.heroImage));
    })
    .sort((a, b) => {
      const dateA = Date.parse(a.data.pubDate || '') || 0;
      const dateB = Date.parse(b.data.pubDate || '') || 0;
      return dateB - dateA || a.slug.localeCompare(b.slug);
    })
    .slice(0, limit);
}

// Claudeでビジュアルシーンを動的生成する（失敗時はnullを返してフォールバックへ）
async function generateSceneWithClaude({ title, description, category }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const system = `You are a visual art director for a Japanese personal finance blog.
Blog persona: Tanaka Ren, a 32-year-old Japanese IT office worker who overcame 2M yen debt.
Task: given an article title and description, write a specific scene description for a photorealistic 16:9 hero image.`;

  const user = `Article title: ${title}
Description: ${description || '(none)'}
Category: ${category}

Write a specific, vivid scene description (2-3 sentences, English only).
Rules:
- Reflect the SPECIFIC topic of this article — not a generic "man at laptop" shot
- Include concrete props, environment, or action directly tied to the article content
- Subject: realistic Japanese 30s office worker or hands-only composition; no brand logos; no celebrities
- Mood: trustworthy, warm daylight, practical, premium but not luxury
- No text in image, no exaggerated money piles

Reply with ONLY the scene description. No explanation, no bullet points.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      console.warn(`  [Claude] scene generation failed: ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json.content?.[0]?.text?.trim() || null;
  } catch (e) {
    console.warn(`  [Claude] scene generation error: ${e.message}`);
    return null;
  }
}

async function promptForArticle({ slug, data }) {
  const category = data.category || 'FX・外貨';
  const title = data.title || slug;
  const description = data.description || '';

  const isFx = category === 'FX・外貨' || FX_SLUGS.has(slug) || slug.includes('fx');
  const categoryScenes = {
    '保険': {
      direction: 'Insurance and household fixed-cost review. Show trustworthy consultation and decision support, not sales pressure.',
      scene: 'a calm Japanese household insurance review scene, insurance papers, family budget notes, laptop checklist, warm daylight, trustworthy consultation mood',
      avoid: 'FX charts, trading screens, broker visuals, gambling feeling, get-rich-quick mood',
    },
    'NISA・投資': {
      direction: 'Long-term investing and asset-building education. Show patient planning and low-pressure decision support.',
      scene: 'a Japanese office worker planning long-term investments with a notebook, tablet portfolio chart, simple asset allocation notes, calm morning light',
      avoid: 'FX trading screens, insurance consultation scenes, credit card closeups, profit guarantees',
    },
    '投資・資産運用': {
      direction: 'Long-term asset management education. Show careful comparison and financial planning.',
      scene: 'a clean Japanese work desk with portfolio notes, tablet charts, calendar, and investment planning documents, realistic apartment setting',
      avoid: 'FX speculation visuals, luxury flexing, guaranteed returns, exaggerated money piles',
    },
    '副業・節税': {
      direction: 'Side business and tax preparation for salaried workers. Show practical documentation and action steps.',
      scene: 'a Japanese office worker organizing receipts, tax forms, laptop spreadsheet, and a checklist after work, practical side-business atmosphere',
      avoid: 'FX charts, broker screens, insurance sales scenes, luxury flexing',
    },
    'クレジットカード': {
      direction: 'Credit card comparison and everyday value. Show practical card choice, points, and household use cases.',
      scene: 'a tidy desk with generic credit cards without logos, point statements, smartphone payment screen, and budgeting notebook, premium but realistic',
      avoid: 'brand logos, readable card numbers, FX charts, insurance consultation scenes, get-rich-quick mood',
    },
    'お得情報': {
      direction: 'Everyday savings and practical money choices. Show useful comparison, not cheap-looking coupon spam.',
      scene: 'a clean household budgeting scene with smartphone coupons, generic cards, calculator, and a notebook, practical saving mood',
      avoid: 'FX trading screens, broker logos, gambling feeling, exaggerated money piles',
    },
    '家計・節約': {
      direction: 'Household budgeting and fixed-cost reduction. Show calm planning and easy next steps.',
      scene: 'a Japanese household budgeting table with bills, notebook, calculator, tea, and a simple checklist, reassuring everyday atmosphere',
      avoid: 'FX trading screens, broker logos, luxury flexing, get-rich-quick mood',
    },
  };

  const fxSpec = {
    direction: 'FX-focused. Prioritize FX account comparison, DMM FX, JFX, FXTF, beginner risk management, and office-worker decision support.',
    scene: [
      'a focused Japanese office worker comparing FX account conditions on a laptop',
      'currency charts, risk notes, a simple comparison checklist, and a clean desk',
      'disciplined and cautious mood, modern Japanese work-from-home setting',
    ].join(', '),
    avoid: 'tax-saving visuals, NISA visuals, insurance consultation scenes, household budgeting scenes, credit cards, profit guarantees, get-rich-quick mood',
  };

  const spec = isFx ? fxSpec : (categoryScenes[category] || {
    direction: 'Personal finance affiliate blog image. Show reader problem-solving, trust, and practical comparison.',
    scene: 'a realistic Japanese personal finance blog image with a laptop, notebook, documents, and warm natural light',
    avoid: 'brand logos, watermarks, exaggerated money piles, gambling feeling, get-rich-quick mood, profit guarantees',
  });

  // Claudeで記事固有のシーンを生成（失敗時は固定シーンにフォールバック）
  const claudeScene = await generateSceneWithClaude({ title, description, category });
  if (claudeScene) {
    console.log(`  [Claude scene] ${claudeScene.slice(0, 100)}${claudeScene.length > 100 ? '...' : ''}`);
  }
  const scene = claudeScene || spec.scene;

  return [
    'Use case: photorealistic-natural',
    'Asset type: 16:9 hero image for a Japanese personal finance affiliate blog article',
    `Business direction: ${spec.direction}`,
    'Marketing perspective: reader-first problem solving, trustworthy comparison, clear next action, no hard-selling, no exaggerated success imagery.',
    'Persona perspective: Tanaka Ren, a 30s Japanese IT office worker, explains money decisions from practical lived experience.',
    `Article title for context: ${title}`,
    `Article category: ${category}`,
    description ? `Article description: ${description}` : '',
    `Scene/backdrop: ${scene}.`,
    'Subject: realistic Japanese 30s office worker or hands-only composition depending on what feels natural; no identifiable celebrity; no brand logos, no broker logos.',
    'Composition: editorial blog cover, strong central visual, clean negative space near the top-left for page layout, professional WordPress-style article thumbnail.',
    'Style: photorealistic, trustworthy, warm daylight, premium but not luxury, practical financial comparison mood, high detail, natural colors.',
    `Avoid: in-image text, fake UI labels, brand logos, watermarks, exaggerated money piles, ${spec.avoid}.`,
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

console.log(`対象: ${targets.length}件 / scope=${allCategories ? 'all-categories' : 'fx-only'} / model=${model} / size=${size} / quality=${quality}`);

for (const target of targets) {
  const imagePath = `/images/articles/${target.slug}.png`;
  const outputPath = path.join(ROOT, 'public', imagePath);
  const prompt = await promptForArticle(target);

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

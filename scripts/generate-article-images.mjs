#!/usr/bin/env node
/**
 * OpenAI Image APIで記事用のヒーロー画像を生成し、MDXのheroImageへ反映する。
 *
 * Usage:
 *   node scripts/generate-article-images.mjs --slug fx-kouza-hikaku
 *   node scripts/generate-article-images.mjs --all --limit 5
 *   node scripts/generate-article-images.mjs --slug fx-kouza-hikaku --dry-run
 *   node scripts/generate-article-images.mjs --slug fx-kouza-hikaku --compose-only
 *   node scripts/generate-article-images.mjs --all --all-categories
 *
 * Required:
 *   OPENAI_API_KEY
 *
 * Optional:
 *   OPENAI_IMAGE_MODEL=gpt-image-2
 *   OPENAI_IMAGE_SIZE=1536x1024
 *   OPENAI_IMAGE_QUALITY=high
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeArticleImage } from './compose-article-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const IMAGE_DIR = path.join(ROOT, 'public/images/articles');
const BASE_IMAGE_DIR = path.join(IMAGE_DIR, 'base');

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
const composeOnly = hasArg('--compose-only');
const limit = Number(getArg('--limit') ?? 999);

const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
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
      articleType: getString('articleType'),
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

function resolveArticleType({ articleType, title = '', slug = '' }) {
  if (articleType) return articleType;
  if (/レビュー|評判|review/i.test(`${title} ${slug}`)) return 'review';
  if (/比較|ランキング|おすすめ|vs|hikaku|ranking/i.test(`${title} ${slug}`)) return 'comparison';
  if (/ニュース|発表|改定|変更|news/i.test(`${title} ${slug}`)) return 'news';
  return 'guide';
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
      if (composeOnly) return fs.existsSync(path.join(BASE_IMAGE_DIR, `${item.slug}.png`));
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
async function generateSceneWithClaude({ title, description, category, articleType }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const system = `You are a visual art director for tsumiba, a Japanese editorial media brand that helps domestic-FX beginners make careful decisions.
Task: given an article title and description, write a specific visual scene for a premium 16:9 editorial hero image. The publisher is an editorial team, not an individual persona.`;

  const user = `Article title: ${title}
Description: ${description || '(none)'}
Category: ${category}
Article type: ${articleType || 'guide'}

Write a specific, vivid scene description (2-3 sentences, English only).
Rules:
- Reflect the SPECIFIC topic of this article — not a generic "man at laptop" shot
- Include concrete props, environment, or action directly tied to the article content
- Choose the best visual subject for the topic: objects, hands, smartphone, comparison cards, documents, or a generic learner. Do not default to a man at a laptop
- No invented personal identity, personal results, debt story, salary, assets, or trading performance
- Mood: trustworthy, practical, editorial, premium but not luxury
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

async function promptForArticle({ slug, data }, { allowClaude = true } = {}) {
  const category = data.category || 'FX・外貨';
  const title = data.title || slug;
  const description = data.description || '';
  const articleType = resolveArticleType({
    articleType: data.articleType,
    title,
    slug,
  });

  const isFx = category === 'FX・外貨' || FX_SLUGS.has(slug) || slug.includes('fx');
  const categoryScenes = {
    '保険': {
      direction: 'Insurance and household fixed-cost review. Show trustworthy consultation and decision support, not sales pressure.',
      scene: 'a calm Japanese household insurance review scene, insurance papers, family budget notes, laptop checklist, warm daylight, trustworthy consultation mood',
      avoid: 'FX charts, trading screens, broker visuals, gambling feeling, get-rich-quick mood',
    },
    'NISA・投資': {
      direction: 'Long-term investing and asset-building education. Show patient planning and low-pressure decision support.',
      scene: 'hands planning long-term investments with a notebook, tablet portfolio shapes, simple asset allocation objects, and calm morning light',
      avoid: 'FX trading screens, insurance consultation scenes, credit card closeups, profit guarantees',
    },
    '投資・資産運用': {
      direction: 'Long-term asset management education. Show careful comparison and financial planning.',
      scene: 'a clean Japanese work desk with portfolio notes, tablet charts, calendar, and investment planning documents, realistic apartment setting',
      avoid: 'FX speculation visuals, luxury flexing, guaranteed returns, exaggerated money piles',
    },
    '副業・節税': {
      direction: 'Side business and tax preparation for salaried workers. Show practical documentation and action steps.',
      scene: 'hands organizing receipts, tax forms, a laptop spreadsheet, and a checklist on a practical home-work desk',
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

  const fxTypeScenes = {
    review: 'a premium editorial still life of a generic smartphone with simplified non-readable app interface shapes, a neutral comparison card, a risk checklist, and carefully arranged desk objects related to the reviewed FX service',
    comparison: 'a clear split-composition editorial scene showing two or three generic smartphone and comparison-card options under the same criteria, with balanced visual weight and no winner crown or ranking hype',
    guide: 'a calm step-by-step learning scene with a smartphone, notebook, three physical step cards, risk notes, and a clear path from learning to comparison',
    news: 'a timely editorial announcement scene with a smartphone notification shape, calendar, official-document motif, and restrained sense of freshness',
  };

  const fxSpec = {
    direction: 'Domestic-FX beginner education. Help the reader compare required funds, smartphone usability, costs, and loss risk without implying profit.',
    scene: fxTypeScenes[articleType] || fxTypeScenes.guide,
    avoid: 'tax-saving visuals, NISA visuals, insurance scenes, credit cards, readable trading UI, profit guarantees, winning trades, get-rich-quick mood',
  };

  const spec = isFx ? fxSpec : (categoryScenes[category] || {
    direction: 'Personal finance affiliate blog image. Show reader problem-solving, trust, and practical comparison.',
    scene: 'a realistic Japanese personal finance blog image with a laptop, notebook, documents, and warm natural light',
    avoid: 'brand logos, watermarks, exaggerated money piles, gambling feeling, get-rich-quick mood, profit guarantees',
  });

  // Claudeで記事固有のシーンを生成（失敗時は固定シーンにフォールバック）
  const claudeScene = allowClaude
    ? await generateSceneWithClaude({ title, description, category, articleType })
    : null;
  if (claudeScene) {
    console.log(`  [Claude scene] ${claudeScene.slice(0, 100)}${claudeScene.length > 100 ? '...' : ''}`);
  }
  const scene = claudeScene || spec.scene;

  return [
    'Use case: photorealistic-natural',
    'Asset type: text-free base artwork for a 16:9 Japanese editorial blog hero and OGP image',
    `Business direction: ${spec.direction}`,
    'Marketing perspective: reader-first problem solving, trustworthy comparison, clear next action, no hard-selling, no exaggerated success imagery.',
    `Article title for context: ${title}`,
    `Article category: ${category}`,
    `Article type: ${articleType}`,
    description ? `Article description: ${description}` : '',
    `Scene/backdrop: ${scene}.`,
    'Subject: use the scene that best explains this article. A person is optional and must be generic; no fixed persona, no identifiable celebrity, no brand or broker logos.',
    'Composition: landscape editorial cover with the main visual weighted to the right half. Keep the left 58% relatively calm and dark enough for a later title overlay.',
    'Style: high-end Japanese editorial illustration or natural editorial photography, trustworthy, practical, calm, visually distinctive, premium but not luxury.',
    `Avoid: all in-image text, letters, numbers, readable UI, fake UI labels, logos, watermarks, upward arrows, candlestick charts, exaggerated money, personal success imagery, ${spec.avoid}.`,
    'Output: landscape base artwork only. Do not render any title or words; title will be added later by code.'
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
  if (composeOnly && slugArg) {
    console.error(`ベース画像がありません: ${path.relative(ROOT, path.join(BASE_IMAGE_DIR, `${slugArg}.png`))}`);
    process.exit(1);
  }
  console.log('対象記事がありません。heroImageなしの記事がないか、slugを確認してください。');
  process.exit(0);
}

console.log(`対象: ${targets.length}件 / scope=${allCategories ? 'all-categories' : 'fx-only'} / model=${model} / size=${size} / quality=${quality}`);

for (const target of targets) {
  const imagePath = `/images/articles/${target.slug}.png`;
  const outputPath = path.join(ROOT, 'public', imagePath);
  const baseOutputPath = path.join(BASE_IMAGE_DIR, `${target.slug}.png`);
  const prompt = composeOnly
    ? null
    : await promptForArticle(target, { allowClaude: !dryRun });

  if (dryRun) {
    if (composeOnly) {
      console.log(`\n--- ${target.slug} ---\ncompose-only: ${path.relative(ROOT, baseOutputPath)} => ${imagePath}`);
    } else {
      console.log(`\n--- ${target.slug} ---\n${prompt}\n=> base: ${path.relative(ROOT, baseOutputPath)}\n=> final: ${imagePath}`);
    }
    continue;
  }

  if (composeOnly) {
    console.log(`compose-only: ${target.slug}`);
  } else if (fs.existsSync(baseOutputPath) && !overwrite) {
    console.log(`skip generation: ${target.slug} ベース画像あり (${path.relative(ROOT, baseOutputPath)})`);
  } else {
    console.log(`generate: ${target.slug}`);
    await generateImage(prompt, baseOutputPath);
  }

  await composeArticleImage({
    basePath: baseOutputPath,
    outputPath,
    title: target.data.title || target.slug,
    category: target.data.category || 'FX・外貨',
  });
  console.log(`composed: ${path.relative(ROOT, outputPath)}`);

  if (!composeOnly) {
    const nextContent = writeHeroImage(target.content, imagePath);
    if (nextContent !== target.content) {
      fs.writeFileSync(target.filePath, nextContent, 'utf-8');
      console.log(`updated: ${path.relative(ROOT, target.filePath)} -> ${imagePath}`);
    } else {
      console.log(`unchanged: ${path.relative(ROOT, target.filePath)}`);
    }
  }
}

console.log('\n完了');

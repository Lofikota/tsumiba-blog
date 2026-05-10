#!/usr/bin/env node
/**
 * X投稿ストック自動生成スクリプト
 * 動作: 記事から5タイプのX投稿を生成し data/x-stock/{slug}-YYYY-MM-DD.md に保存
 * 環境変数: ANTHROPIC_API_KEY
 * 使い方:
 *   node scripts/generate-x-stock.mjs --slug fx-kouza-hikaku
 *   node scripts/generate-x-stock.mjs  # keyword-queue.json の最新 published を使用
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
};

const requestedSlug = getArg('slug') || process.env.ARTICLE_SLUG || '';

const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/keyword-queue.json'), 'utf-8'));
const target = requestedSlug
  ? queue.find(k => k.slug === requestedSlug)
  : [...queue].reverse().find(k => k.status === 'published');

if (!target) {
  console.log('対象記事なし。終了します。');
  process.exit(0);
}

if (target.status !== 'published') {
  console.log(`published ではありません: ${target.slug} (${target.status})`);
  process.exit(0);
}

// 既にストック生成済みか確認
const stockDir = path.join(ROOT, 'data/x-stock');
if (!fs.existsSync(stockDir)) fs.mkdirSync(stockDir, { recursive: true });
const existing = fs.readdirSync(stockDir).filter(f => f.startsWith(target.slug));
if (existing.length > 0) {
  console.log(`ストック生成済みをスキップ: ${target.slug}`);
  const stockPath = path.join(stockDir, existing[0]);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `stock_path=${stockPath}\n`);
  }
  process.exit(0);
}

const mdxPath = path.join(ROOT, `src/content/blog/${target.slug}.mdx`);
if (!fs.existsSync(mdxPath)) {
  console.log(`MDXファイルなし: ${target.slug}`);
  process.exit(0);
}

const articleContent = fs.readFileSync(mdxPath, 'utf-8').slice(0, 4000);
const articleUrl = `https://ren-money.com/blog/${target.slug}/`;

// 今日から+1〜+5日の予定日を生成
const today = new Date();
const scheduleDates = Array.from({ length: 5 }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() + i + 1);
  return d.toISOString().slice(0, 10);
});

const client = new Anthropic();
console.log(`X投稿ストック生成中: ${target.slug}`);

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 2500,
  system: `あなたは田中蓮（32歳・IT会社員・副業月20万・35歳FIRE目標）として、ブログ記事をX投稿に変換するプロです。

【田中蓮の文体】
- カジュアル・ひらがな多め・共感ファースト
- 数字・体験を先出し
- 「一緒に頑張ろう」スタンス。説教しない
- 絵文字は1投稿に1〜2個まで
- 1投稿は140字以内（日本語）

【禁止表現】
確実に儲かる・必ず増える・元本保証・誰でも稼げる・絶対に

【出力形式】
以下のJSONを返してください（コードブロックなし）:
{
  "posts": [
    {
      "type": "逆説型",
      "hook": "〇〇してはいけない、という話",
      "body": "投稿本文（140字以内）",
      "cta": "ブログで詳しく解説してます👇\\n${articleUrl}"
    },
    {
      "type": "体験談型",
      "hook": "昔の僕がやった失敗",
      "body": "投稿本文（140字以内）",
      "cta": null
    },
    {
      "type": "あるある型",
      "hook": "こういう人いませんか",
      "body": "投稿本文（140字以内）",
      "cta": null
    },
    {
      "type": "質問型",
      "hook": "みんなに聞きたいんだけど",
      "body": "投稿本文（140字以内）",
      "cta": null
    },
    {
      "type": "数字まとめ型",
      "hook": "〇選・〇つのポイント",
      "body": "投稿本文（140字以内）",
      "cta": "詳細はブログで👇\\n${articleUrl}"
    }
  ]
}`,
  messages: [{
    role: 'user',
    content: `以下の記事から5タイプのX投稿ストックを作成してください。

記事URL: ${articleUrl}
キーワード: ${target.keyword}
カテゴリ: ${target.category}

記事内容:
${articleContent}`,
  }],
});

let posts;
try {
  const raw = response.content[0].text;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  posts = JSON.parse(json).posts;
  if (!Array.isArray(posts) || posts.length < 5) throw new Error('posts配列不正');
} catch (e) {
  console.error('JSON解析失敗:', e.message);
  console.error('レスポンス:', response.content[0].text.slice(0, 500));
  process.exit(1);
}

// Markdownに整形して保存
const today0 = today.toISOString().slice(0, 10);
const fileName = `${target.slug}-${today0}.md`;
const filePath = path.join(stockDir, fileName);

const lines = [
  `# X投稿ストック: ${target.keyword}`,
  ``,
  `- 記事: ${articleUrl}`,
  `- 生成日: ${today0}`,
  `- slug: ${target.slug}`,
  ``,
  `---`,
  ``,
];

posts.forEach((p, i) => {
  const date = scheduleDates[i];
  const body = p.cta ? `${p.body}\n\n${p.cta}` : p.body;
  lines.push(`## ${date}（${p.type}）`);
  lines.push(``);
  lines.push(`> ${p.hook}`);
  lines.push(``);
  lines.push(body);
  lines.push(``);
  lines.push(`- [ ] 投稿済み`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
});

fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
console.log(`✅ ストック保存: ${filePath}`);
console.log(`   ${posts.length}件 / ${scheduleDates[0]} 〜 ${scheduleDates[4]}`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `stock_path=data/x-stock/${fileName}\n`);
}

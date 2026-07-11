#!/usr/bin/env node
/**
 * X（Twitter）自動投稿スクリプト
 * 動作: 直近publishedの記事からClaudeがスレッドを生成 → X APIで投稿
 * 環境変数: X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET / ANTHROPIC_API_KEY
 */
import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};

const requestedSlug = getArg('slug') || process.env.ARTICLE_SLUG || '';

// 投稿対象記事を取得。Actions では生成工程の slug を必ず渡し、過去記事の誤投稿を防ぐ。
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/keyword-queue.json'), 'utf-8'));
const latest = requestedSlug
  ? queue.find(k => k.slug === requestedSlug)
  : [...queue].reverse().find(k => k.status === 'published');

if (!latest) {
  if (requestedSlug) {
    console.error(`投稿対象の記事がキューにありません: ${requestedSlug}`);
    process.exit(1);
  }
  console.log('投稿対象の記事なし。終了します。');
  process.exit(0);
}

if (latest.status !== 'published') {
  console.log(`投稿対象が published ではありません: ${latest.slug} (${latest.status})`);
  process.exit(0);
}

const mdxPath = path.join(ROOT, `src/content/blog/${latest.slug}.mdx`);
if (!fs.existsSync(mdxPath)) {
  console.log(`MDXファイルが見つかりません: ${latest.slug}`);
  process.exit(0);
}

// 投稿済みフラグ確認（二重投稿防止）
if (latest.xPostedAt) {
  console.log(`既に投稿済み: ${latest.slug} (${latest.xPostedAt})`);
  process.exit(0);
}

const articleContent = fs.readFileSync(mdxPath, 'utf-8').slice(0, 3000);
const articleUrl = `https://ren-money.com/blog/${latest.slug}/`;

// Claudeでスレッド生成
const client = new Anthropic();
console.log(`Xスレッド生成中: ${latest.slug}`);

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1500,
  system: `あなたはtsumiba（FX口座比較メディア）の編集部です。架空の経歴・個人実績は語らず、比較検証と公式情報の確認に基づいて書きます。
ブログ記事をXのスレッド（3ツイート）に変換します。

【文体】
- カジュアル・ひらがな多め・共感ファースト
- 数字を先出し（「3つある」「5分でわかる」など）
- 「一緒に頑張ろう」スタンス。説教しない
- 絵文字は1ツイートに1〜2個まで

【スレッド構成】
1ツイート目: フック（「〜な人いる?」「実は僕も〜」で始める）＋ツイート1内で価値提供
2ツイート目: 具体的な数字・比較・ポイント3つ以内
3ツイート目: まとめ＋「詳しくはブログで👇」＋URL

【ルール】
- 1ツイートは140字以内（日本語）
- URLは3ツイート目だけ
- 「確実に儲かる」等の禁止表現は使わない
- JSON形式で出力: { "tweets": ["1ツイート目", "2ツイート目", "3ツイート目"] }`,
  messages: [{
    role: 'user',
    content: `以下の記事からXスレッドを作成してください。

記事URL: ${articleUrl}
キーワード: ${latest.keyword}

記事内容（冒頭）:
${articleContent}`,
  }],
});

let tweets;
try {
  const raw = response.content[0].text;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  tweets = JSON.parse(json).tweets;
  if (!Array.isArray(tweets) || tweets.length < 3) throw new Error('tweets配列が不正');
} catch (e) {
  console.error('スレッドJSON解析失敗:', e.message);
  process.exit(1);
}

// URLを3ツイート目に確実に含める
if (!tweets[2].includes('ren-money.com')) {
  tweets[2] = tweets[2].trimEnd() + `\n\n詳しくはブログで👇\n${articleUrl}`;
}

console.log('\n--- 生成されたスレッド ---');
tweets.forEach((t, i) => console.log(`[${i + 1}] ${t}\n`));

// X API 投稿
const xRequired = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
const missingX = xRequired.filter(k => !process.env[k]);
if (missingX.length > 0) {
  console.warn(`X API環境変数未設定: ${missingX.join(', ')}`);
  console.log('（ドライラン）スレッドのみ出力して終了します。');
  process.exit(0);
}

const xClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

// スレッド投稿（1→2→3の順に返信チェーン）
let lastId = null;
for (const tweet of tweets) {
  const params = lastId ? { text: tweet, reply: { in_reply_to_tweet_id: lastId } } : { text: tweet };
  const result = await xClient.v2.tweet(params);
  lastId = result.data.id;
  console.log(`✅ 投稿: ${result.data.id}`);
  // レート制限対策（1秒待機）
  await new Promise(r => setTimeout(r, 1000));
}

// キューに投稿済みフラグを記録
latest.xPostedAt = new Date().toISOString();
fs.writeFileSync(path.join(ROOT, 'data/keyword-queue.json'), JSON.stringify(queue, null, 2), 'utf-8');
console.log(`\n✅ Xスレッド投稿完了: ${latest.slug}`);

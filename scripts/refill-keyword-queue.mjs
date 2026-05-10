#!/usr/bin/env node
/**
 * キーワードキュー自動補充スクリプト
 * 動作: GSC上位クエリのうち impressions>=50 かつ position>10 のものを
 *       keyword-queue.json の pending として追加
 * 環境変数: GSC_SERVICE_ACCOUNT_JSON / GSC_SITE_URL / ANTHROPIC_API_KEY
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchSearchAnalytics } from './gsc-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'data/keyword-queue.json');

function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`);
}

// 日本語キーワード → ASCII スラッグ変換（Claudeに依頼）
async function generateSlug(client, keyword) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: `以下のキーワードを英語のURLスラッグ（小文字英数字とハイフンのみ・30文字以内）に変換してください。
キーワード: ${keyword}
スラッグのみ出力（説明不要）:`,
    }],
  });
  return res.content[0].text.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30);
}

// カテゴリ推測
function guessCategory(keyword) {
  if (/FX|外国為替|スプレッド|レバレッジ|pips/i.test(keyword)) return 'FX・外貨';
  if (/NISA|iDeCo|積立|ETF|投資信託|証券|株/i.test(keyword)) return '投資・資産運用';
  if (/クレカ|クレジット|ポイント|年会費/i.test(keyword)) return 'クレジットカード';
  if (/副業|稼ぐ|フリーランス|ブログ|アフィリエイト/i.test(keyword)) return '副業・節税';
  if (/確定申告|節税|経費|住民税|所得税/i.test(keyword)) return '副業・節税';
  if (/節約|家計|固定費|支出/i.test(keyword)) return '家計・節約';
  return '金融・お金';
}

// メイン処理
const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
const existingKeywords = new Set(queue.map(k => k.keyword.toLowerCase()));
const existingSlugs = new Set(queue.map(k => k.slug));

// GSCデータが利用可能な場合のみ実行
const gscRequired = ['GSC_SERVICE_ACCOUNT_JSON', 'GSC_SITE_URL'];
const missingGSC = gscRequired.filter(k => !process.env[k]);
if (missingGSC.length > 0) {
  console.warn(`GSC環境変数未設定: ${missingGSC.join(', ')}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    setOutput('added_count', 0);
    console.error('GitHub ActionsではGSCなしのデフォルト補充を禁止します。Secretsを設定してください。');
    process.exit(1);
  }

  console.log('GSCなしモード: デフォルトキーワードを5件追加します。');

  const defaults = [
    { keyword: 'SBI FX α スプレッド 比較', category: 'FX・外貨', notes: 'SBI FX αの特徴とスプレッドを他社と比較' },
    { keyword: '楽天証券 NISA 2024 新制度', category: '投資・資産運用', notes: '楽天証券での新NISA設定手順' },
    { keyword: 'ふるさと納税 おすすめ サイト 比較', category: '家計・節約', notes: 'ふるさと納税サイトをポイント還元率で比較' },
    { keyword: 'au PAY カード ポイント 還元率', category: 'クレジットカード', notes: 'au PAYカードのメリット・デメリット' },
    { keyword: '副業 バレない 方法 住民税', category: '副業・節税', notes: '副業が会社にバレないための住民税対策' },
  ];

  let added = 0;
  for (const item of defaults) {
    const slug = item.keyword.toLowerCase()
      .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 30)
      .replace(/[^a-z0-9-]/g, '');

    if (!existingSlugs.has(slug) && !existingKeywords.has(item.keyword.toLowerCase())) {
      queue.push({
        slug,
        keyword: item.keyword,
        type: 'guide',
        category: item.category,
        notes: item.notes,
        status: 'pending',
        addedBy: 'refill-default',
      });
      added++;
      console.log(`+ ${item.keyword}`);
    }
  }

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
  console.log(`\n${added}件のキーワードを追加しました。`);
  setOutput('added_count', added);
  process.exit(0);
}

console.log('GSCデータ取得中...');
const gscData = await fetchSearchAnalytics(28);

// 改善余地のあるクエリを抽出（impressions>=50 かつ position>10）
const candidates = [];
for (const page of gscData) {
  for (const q of (page.queries || [])) {
    if (q.impressions >= 50 && q.position > 10) {
      const kw = q.query;
      if (!existingKeywords.has(kw.toLowerCase()) && kw.length >= 5) {
        candidates.push({ keyword: kw, impressions: q.impressions, position: q.position });
      }
    }
  }
}

// impressions降順でソートして上位10件
candidates.sort((a, b) => b.impressions - a.impressions);
const top = candidates.slice(0, 10);

if (top.length === 0) {
  console.log('追加候補のキーワードがありませんでした。');
  setOutput('added_count', 0);
  process.exit(0);
}

console.log(`追加候補: ${top.length}件`);

const client = new Anthropic();
let added = 0;

for (const { keyword, impressions, position } of top) {
  const slug = await generateSlug(client, keyword);

  if (existingSlugs.has(slug)) {
    console.log(`スキップ（スラッグ重複）: ${keyword}`);
    continue;
  }

  const category = guessCategory(keyword);
  queue.push({
    slug,
    keyword,
    type: 'guide',
    category,
    notes: `GSC自動補充: impressions=${impressions}, position=${position.toFixed(1)}`,
    status: 'pending',
    addedBy: 'refill-gsc',
    addedAt: new Date().toISOString(),
  });

  existingSlugs.add(slug);
  existingKeywords.add(keyword.toLowerCase());
  added++;
  console.log(`+ ${keyword} (pos:${position.toFixed(1)}, imp:${impressions}) → ${slug}`);
}

fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
console.log(`\n✅ ${added}件のキーワードをキューに追加しました。`);
setOutput('added_count', added);

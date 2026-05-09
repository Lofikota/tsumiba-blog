#!/usr/bin/env node
/**
 * 記事自動生成スクリプト
 * 動作: keyword-queue.json から pending を1件取得 → Claude API で記事生成 → 品質チェック → MDX保存
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkArticle } from './quality-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const queuePath = path.join(ROOT, 'data/keyword-queue.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));

const pending = queue.find(k => k.status === 'pending');
if (!pending) {
  console.log('キューに pending の記事がありません。終了します。');
  process.exit(0);
}

// 記事スラッグが既存の場合はスキップ
const outputPath = path.join(ROOT, `src/content/blog/${pending.slug}.mdx`);
if (fs.existsSync(outputPath)) {
  console.log(`既存記事があるためスキップ: ${pending.slug}`);
  pending.status = 'skipped';
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
  process.exit(0);
}

// スタイル参考記事（最初の2,500字）
const examplePath = path.join(ROOT, 'src/content/blog/fx-kouza-hikaku.mdx');
const exampleContent = fs.readFileSync(examplePath, 'utf-8').slice(0, 2500);

const today = new Date().toISOString().split('T')[0];

const SYSTEM_PROMPT = `あなたは「田中蓮（32歳・IT会社員・副業月20万円・35歳FIRE目標）」として金融アフィリエイトブログを執筆するライターです。

【田中蓮のバックストーリー】
- 25〜27歳：浪費癖でクレカリボ払いが膨らみ借金200万円
- 28歳：友人の「副業で月5万」発言に刺激を受け、お金の本を初めて読む
- 28歳：副業ライティング開始→最初の月は3,000円
- 30歳：3年かけてリボ払いを完済。NISAとiDeCoを同時スタート
- 現在（32歳）：副業月20万・本業手取り月30万・資産500万・月5万FX運用中

【文体ルール】
- ひらがな多め・カジュアル。「〜です/ます」と「〜だ」を自然に混在
- 失敗談・数字・具体例を先に出す（抽象論は書かない）
- 「一緒に頑張ろう」スタンス。説教しない
- 「中学生でもわかる」を意識。専門用語は必ずひとことで解説

【必須要素】
1. frontmatterに pubDate と updatedDate（両方 ${today}）を含める
2. 本文冒頭に「> アフィリエイト広告を含みます」
3. 金融・投資記事にはリスク表記（元本割れ・損失・自己責任）を含める
4. 本文3,000字以上（frontmatter・import行は含まない）
5. 末尾に【免責事項】と著者情報（田中蓮）

【絶対に書いてはいけないこと】
- 確実に儲かる・絶対に損しない・元本保証・必ず増える・誰でも稼げる

【MDXフォーマット（厳守）】
---
title: "..."
description: "..."（120字以内）
pubDate: ${today}
updatedDate: ${today}
category: "..."
tags: [...]
heroImage: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=640&h=400&fit=crop&q=80"
affiliate: true
---

import AffiliateCTA from '../../components/AffiliateCTA.astro';

【コンポーネント使用ルール】
- ComparisonTableは使わない。比較表はMarkdownのテーブル記法で書く
- AffiliateCTAは必ずtextプロパティを指定する: <AffiliateCTA text="公式サイトで詳細を確認する" href="https://example.com" />

【参考スタイル（この文体・構成を模倣すること）】
${exampleContent}`;

console.log(`記事を生成中: ${pending.slug} (KW: ${pending.keyword})`);

const client = new Anthropic();

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 8192,
  system: SYSTEM_PROMPT,
  messages: [
    {
      role: 'user',
      content: `以下のキーワードで、田中蓮として3,000字以上のブログ記事をMDX形式で書いてください。

メインKW: ${pending.keyword}
記事タイプ: ${pending.type}
スラッグ: ${pending.slug}
カテゴリ: ${pending.category}
補足・方針: ${pending.notes || 'なし'}

frontmatterから本文末尾まで、MDXファイルとして完結した内容にしてください。
コードブロックで囲まず、MDXのテキストをそのまま出力してください。`,
    },
  ],
});

const generatedContent = response.content[0].text;

// 品質チェック
const qcResult = checkArticle(generatedContent, pending.slug);
console.log(`\n[品質チェック] 文字数: ${qcResult.charCount.toLocaleString()}字`);

if (!qcResult.ok) {
  console.error('\n❌ 品質チェック失敗:');
  qcResult.errors.forEach(e => console.error(`  - ${e}`));
  pending.status = 'quality_failed';
  pending.failReason = qcResult.errors.join('; ');
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
  process.exit(1);
}

if (qcResult.warnings.length > 0) {
  console.log('⚠️  警告:');
  qcResult.warnings.forEach(w => console.log(`  - ${w}`));
}

// 記事保存
fs.writeFileSync(outputPath, generatedContent, 'utf-8');
console.log(`\n✅ 記事保存完了: src/content/blog/${pending.slug}.mdx`);

// キュー更新
pending.status = 'published';
pending.publishedAt = new Date().toISOString();
fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
console.log(`キュー更新: ${pending.slug} → published`);

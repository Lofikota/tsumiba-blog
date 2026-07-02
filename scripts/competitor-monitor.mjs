#!/usr/bin/env node
/**
 * 競合記事モニタリングスクリプト
 * 動作: data/competitor-targets.json の対象URLをフェッチ
 *       → 前回スナップショットと差分比較
 *       → 変化があればClaudeが改善提案レポートを生成
 *       → KPI管理/competitor-reports/ に保存
 * 環境変数: ANTHROPIC_API_KEY
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TARGETS_PATH = path.join(ROOT, 'data/competitor-targets.json');
const SNAPSHOT_PATH = path.join(ROOT, 'data/competitor-snapshots.json');
const REPORT_DIR = path.join(ROOT, 'KPI管理/competitor-reports');

// HTMLからプレーンテキスト本文を抽出
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 5000);
}

// URLフェッチ（User-Agentを一般ブラウザに偽装しない、普通のfetch）
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractText(html);
  } catch {
    return null;
  }
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// デフォルトターゲットファイルを作成
if (!fs.existsSync(TARGETS_PATH)) {
  const defaultTargets = [
    {
      keyword: 'FX 初心者 おすすめ 口座',
      urls: [
        'https://money-bu-jpx.com/fx/',
        'https://fxy.jp/fx/beginners/',
      ],
    },
    {
      keyword: 'iDeCo 始め方 会社員',
      urls: [
        'https://moneyforward.com/media/financial-knowledge/ideco/',
      ],
    },
  ];
  fs.writeFileSync(TARGETS_PATH, JSON.stringify(defaultTargets, null, 2), 'utf-8');
  console.log(`競合ターゲットファイルを作成: ${TARGETS_PATH}`);
}

const targets = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8'));
const snapshots = fs.existsSync(SNAPSHOT_PATH)
  ? JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'))
  : {};

if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

const client = new Anthropic();
const today = new Date().toISOString().split('T')[0];
const reportLines = [`# 競合モニタリングレポート ${today}\n`];
let changesDetected = 0;

for (const target of targets) {
  console.log(`\n[${target.keyword}] 競合チェック中...`);
  reportLines.push(`## ${target.keyword}\n`);

  for (const url of target.urls) {
    console.log(`  フェッチ: ${url}`);
    const text = await fetchPage(url);

    if (!text) {
      console.log(`  ⚠️  取得失敗: ${url}`);
      reportLines.push(`- ⚠️ 取得失敗: ${url}\n`);
      continue;
    }

    const hash = md5(text);
    const prev = snapshots[url];

    if (prev && prev.hash === hash) {
      console.log(`  変化なし: ${url}`);
      reportLines.push(`- 変化なし: ${url}\n`);
      continue;
    }

    const isNew = !prev;
    changesDetected++;
    console.log(`  ${isNew ? '新規登録' : '変化検出'}: ${url}`);
    reportLines.push(`- ${isNew ? '🆕 新規登録' : '🔄 変化検出'}: ${url}\n`);

    // Claude で改善提案を生成
    const prompt = isNew
      ? `以下は「${target.keyword}」で上位にある競合記事の本文です。
この記事の強みと弱みを分析し、編集部（32歳・IT会社員・副業月20万）のブログで同テーマの記事を書く際の改善ポイントを3つ提案してください。`
      : `「${target.keyword}」の競合記事が更新されました。
変更後の内容を分析し、編集部のブログで対抗するための改善ポイントを3つ提案してください。`;

    try {
      const res = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `${prompt}\n\n競合記事本文（抜粋）:\n${text.slice(0, 2000)}`,
        }],
      });

      const analysis = res.content[0].text;
      reportLines.push(`\n**分析結果:**\n${analysis}\n`);
      console.log(`  ✅ Claude分析完了`);
    } catch (e) {
      console.warn(`  Claude分析エラー: ${e.message}`);
    }

    // スナップショット更新
    snapshots[url] = { hash, fetchedAt: new Date().toISOString(), keyword: target.keyword };

    // レート制限対策
    await new Promise(r => setTimeout(r, 1500));
  }
}

// スナップショット保存
fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshots, null, 2), 'utf-8');

// レポート保存
const reportPath = path.join(REPORT_DIR, `${today}.md`);
fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');

console.log(`\n✅ 競合モニタリング完了`);
console.log(`   変化検出: ${changesDetected}件`);
console.log(`   レポート: KPI管理/competitor-reports/${today}.md`);

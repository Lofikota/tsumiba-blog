#!/usr/bin/env node
/**
 * 記事一括生成スクリプト
 * keyword-queue.json の全 pending を順番に生成する。
 * generate-article.mjs を pending の数だけ順番に呼ぶだけ。
 *
 * 使い方:
 *   node scripts/batch-generate.mjs          # 全 pending を生成
 *   node scripts/batch-generate.mjs --dry-run # 対象一覧を表示して終了
 *   node scripts/batch-generate.mjs --category FX・外貨  # カテゴリ絞り込み
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const queuePath = path.join(ROOT, 'data/keyword-queue.json');
const scriptPath = path.join(__dirname, 'generate-article.mjs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const categoryIdx = args.indexOf('--category');
const categoryFilter = categoryIdx !== -1 ? args[categoryIdx + 1] : null;

function getPending() {
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  return queue.filter(k => {
    if (k.status !== 'pending') return false;
    if (categoryFilter && k.category !== categoryFilter) return false;
    return true;
  });
}

const initialPending = getPending();

if (initialPending.length === 0) {
  console.log('生成対象の pending 記事がありません。');
  process.exit(0);
}

console.log('\n===== 一括生成開始 =====');
console.log(`対象: ${initialPending.length} 本`);
initialPending.forEach((k, i) => {
  console.log(`  ${i + 1}. [${k.category}] ${k.slug} | ${k.keyword}`);
});

if (dryRun) {
  console.log('\n--dry-run モード: 実行せずに終了します');
  process.exit(0);
}

console.log('\n');

const results = { ok: [], failed: [] };
const total = initialPending.length;

for (let i = 0; i < total; i++) {
  const remaining = getPending();
  if (remaining.length === 0) break;

  const item = remaining[0];
  console.log(`\n[${i + 1}/${total}] 生成中: ${item.slug}`);
  console.log(`  KW: ${item.keyword} | カテゴリ: ${item.category}`);

  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    cwd: ROOT,
  });

  if (result.status === 0) {
    results.ok.push(item.slug);
  } else {
    console.error(`  ❌ 失敗: ${item.slug} (exit ${result.status})`);
    results.failed.push(item.slug);
  }

  // API レート制限対策
  if (i < total - 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
}

console.log('\n===== 一括生成完了 =====');
console.log(`✅ 成功: ${results.ok.length} 本`);
results.ok.forEach(s => console.log(`   - ${s}`));
if (results.failed.length > 0) {
  console.log(`❌ 失敗: ${results.failed.length} 本`);
  results.failed.forEach(s => console.log(`   - ${s}`));
}

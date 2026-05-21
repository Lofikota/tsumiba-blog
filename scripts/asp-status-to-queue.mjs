#!/usr/bin/env node
/**
 * asp-status-to-queue.mjs
 *
 * data/asp-status.md の「承認済み」セクションを読み取り、
 * keyword-queue.json にまだ追加されていない案件を検出して
 * asp-approval-to-queue.mjs に渡す。
 *
 * Gmail OAuth は不要。Claude が Gmail MCP でメールを確認し、
 * data/asp-status.md を更新→コミット→push した後に
 * このスクリプトが GitHub Actions から呼ばれる設計。
 *
 * 使い方:
 *   node scripts/asp-status-to-queue.mjs            # 新規承認を検出してキュー追加
 *   node scripts/asp-status-to-queue.mjs --dry-run  # 検出のみ（書き込みなし）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STATUS_PATH = path.join(ROOT, 'data/asp-status.md');
const QUEUE_PATH = path.join(ROOT, 'data/keyword-queue.json');
// 処理済みエントリを追跡するファイル（site承認など、キューに入らないものも記録）
const PROCESSED_PATH = path.join(ROOT, 'data/asp-status-processed.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// ── GITHUB_OUTPUT ──────────────────────────────────────
function setOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${key}=${String(value)}\n`);
}

// ── asp-status.md の 承認済みセクションを解析 ────────────
function parseApprovedSection(content) {
  const lines = content.split('\n');
  let inApproved = false;
  let inHeader = false;
  const rows = [];

  for (const line of lines) {
    if (line.startsWith('## 承認済み')) {
      inApproved = true;
      inHeader = false;
      continue;
    }
    if (inApproved && line.startsWith('## ')) {
      break; // 次のセクションへ
    }
    if (!inApproved) continue;
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.every(c => /^[-:]+$/.test(c))) continue; // セパレータ
    if (cells[0] === 'ASP') { inHeader = true; continue; } // ヘッダ行

    // ASP | プログラム / 備考 | 承認日
    const [asp, program, date] = cells;
    if (asp && program) {
      rows.push({ asp: asp.trim(), program: program.trim(), date: (date ?? '').trim() });
    }
  }

  return rows;
}

// ── サイト登録（プログラムでなく）を除外 ─────────────────
const SITE_PATTERNS = [
  /^ren-money\.com/i,
  /サイト.*登録/,
  /サイト.*承認/,
  /^登録承認/,
  /^site$/i,
  /本人認証/,  // afbの認証待ちメッセージを含む行は除外
];
function isSiteApproval(program) {
  // ⚠️マークなど補足テキストは除いて先頭部分で判定
  const p = program.replace(/⚠️.+$/, '').trim();
  return SITE_PATTERNS.some(re => re.test(p));
}

// ── 処理済みリストの読み書き ─────────────────────────────
function loadProcessed() {
  if (!fs.existsSync(PROCESSED_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(PROCESSED_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveProcessed(list) {
  if (DRY_RUN) return;
  fs.writeFileSync(PROCESSED_PATH, JSON.stringify(list, null, 2) + '\n', 'utf-8');
}

// ── メイン ───────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  ASPステータス → キュー自動追加 (v2)      ║');
  console.log('╚══════════════════════════════════════════╝');
  if (DRY_RUN) console.log('  [DRY-RUN モード]');
  console.log('');

  if (!fs.existsSync(STATUS_PATH)) {
    console.error(`❌ ${STATUS_PATH} が見つかりません。`);
    setOutput('asp_approved_count', 0);
    setOutput('asp_approved_list', 'なし');
    process.exit(0);
  }

  const content = fs.readFileSync(STATUS_PATH, 'utf-8');
  const approved = parseApprovedSection(content);
  console.log(`承認済みセクション: ${approved.length} 件`);

  const processed = loadProcessed();
  const processedKeys = new Set(processed.map(p => `${p.asp}×${p.program}`));

  // keyword-queue.jsonの既存slugとkeyword
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  const queueSlugs = new Set(queue.map(q => q.slug));

  const newApproved = [];
  const siteApprovals = [];

  for (const row of approved) {
    const key = `${row.asp}×${row.program}`;

    if (isSiteApproval(row.program)) {
      siteApprovals.push(row);
      // 処理済みに追加（再チェックしない）
      if (!processedKeys.has(key)) {
        processed.push({ ...row, processedAt: new Date().toISOString(), type: 'site' });
        processedKeys.add(key);
      }
      continue;
    }

    if (processedKeys.has(key)) {
      console.log(`  ↩ スキップ（処理済み）: ${key}`);
      continue;
    }

    newApproved.push(row);
  }

  console.log(`\n新規承認プログラム: ${newApproved.length} 件`);
  console.log(`サイト承認（スキップ）: ${siteApprovals.length} 件`);

  if (newApproved.length === 0) {
    console.log('\n新規追加なし。');
    setOutput('asp_approved_count', 0);
    setOutput('asp_approved_list', 'なし');
    if (!DRY_RUN) saveProcessed(processed);
    return;
  }

  newApproved.forEach(r => {
    console.log(`  ✅ ${r.asp} × ${r.program} [${r.date}]`);
  });

  // asp-approval-to-queue.mjs に渡す形式: "ASP×プログラム名, ..."
  const approvedList = newApproved.map(r => `${r.asp}×${r.program}`).join(', ');
  console.log(`\n承認リスト: ${approvedList}`);

  setOutput('asp_approved_count', newApproved.length);
  setOutput('asp_approved_list', approvedList);

  // 処理済みに追加
  for (const row of newApproved) {
    processed.push({ ...row, processedAt: new Date().toISOString(), type: 'program' });
  }

  if (!DRY_RUN) {
    saveProcessed(processed);
    console.log(`\n💾 処理済みリストを更新: ${processed.length} 件`);
  }
  console.log('');
}

main().catch(e => {
  console.error('致命的エラー:', e.message);
  process.exit(1);
});

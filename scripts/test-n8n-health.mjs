#!/usr/bin/env node
/**
 * test-n8n-health.mjs — ops-doctor §3-2（n8n稼働検知）の分岐テスト
 *
 * なぜ要るか: 実環境は現在「4本すべて停止」で、🚨側の分岐しか通らない。
 * 正常判定と観測失効（7日/14日）の分岐は、本番では最短でも7日待たないと一度も実行されない。
 * 未実行のまま出荷すると「鳴るはずのアラームが実は鳴らない」＝検知装置そのものの沈黙障害になる。
 *
 * 実行: node scripts/test-n8n-health.mjs
 * 注入口: N8N_STATUS_FILE（§6-3 の ROOTDOCS_DIR と同じ <対象>_<用途> 規約）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCTOR = path.join(__dirname, 'ops-doctor.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-health-'));

const daysAgoISO = (d) => new Date(Date.now() - d * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const hoursAgoISO = (h) => daysAgoISO(h / 24);
// updatedAt の既定は30日前＝「有効化からもう十分経っている」状態。ここを「今」にすると
// 有効化直後の猶予（2026-08-01 N8N-D01）に入ってしまい、沈黙系のケースが検証にならない。
const wf = (name, over = {}) => ({ id: name, name, active: true, triggerCount: 1, lastAutoExecutionAt: daysAgoISO(0), updatedAt: daysAgoISO(30), ...over });

// ops-doctor は他チェックの結果で終了コードが変わるので、判定はn8n行の本文で行う。
// 行には所属セクション（🚨/⚠️/ℹ️）を前置する。イベント駆動WFの「⚠️へ格下げ」は
// 文言ではなく深刻度そのものが仕様なので、深刻度を見ないテストでは検証できない。
// --no-net で git fetch を省き、テストをオフラインでも安定させる。
function run(statusFile) {
  try {
    return execFileSync('node', [DOCTOR, '--no-net'], {
      encoding: 'utf-8',
      env: { ...process.env, N8N_STATUS_FILE: statusFile },
    });
  } catch (e) {
    return e.stdout ?? '';   // 🚨があると exit 2 で throw する。出力自体は正常
  }
}
// 他チェックのメッセージにも "n8n" を含む文字列は現れる（例: ファイル名 test-n8n-health.mjs）。
// checkN8nHealth のメッセージは必ず "n8n" で始まる契約なので、箇条書きの先頭で判定し、
// その続き（→ で始まる行）を同じ深刻度で拾う。
function n8nLines(statusFile) {
  const rows = [];
  let sev = '', inN8n = false;
  for (const line of run(statusFile).split('\n')) {
    const head = ['🚨', '⚠️', 'ℹ️'].find((s) => line.startsWith(s));
    if (head) { sev = head; inN8n = false; continue; }
    const bullet = line.match(/^\s*-\s(.*)$/);
    if (bullet) {
      inN8n = /^n8n/.test(bullet[1]);
      if (inN8n) rows.push(`${sev} ${bullet[1]}`);
      continue;
    }
    if (inN8n && line.trim()) rows.push(`${sev} ${line.trim()}`);
  }
  return rows;
}

function fixture(name, snapshot) {
  const f = path.join(tmp, `${name}.json`);
  fs.writeFileSync(f, snapshot === null ? 'not json{' : JSON.stringify(snapshot));
  return f;
}

// quiet:'quiet' のケースは「🚨も⚠️も1行も出ない」ことまで確かめる。
// 期待する文言が出るだけでは不十分で、別の誤警報が同時に出ていないことが本質。
const cases = [
  ['ファイル不在なら🚨', path.join(tmp, 'nope.json'), /🚨 .*スナップショットが無い/],
  ['壊れたJSONなら🚨', fixture('broken', null), /🚨 .*壊れている/],
  ['形式不正なら🚨', fixture('shape', { observedAt: daysAgoISO(0) }), /🚨 .*形式が不正/],
  ['正常なら🚨も⚠️も出さない',
    fixture('green', { observedAt: daysAgoISO(1), credentialCount: 2, workflows: [wf('asp-detect-approval-mail')] }),
    /稼働対象 1 本すべて正常/, 'quiet'],
  ['観測7日超で⚠️',
    fixture('stale7', { observedAt: daysAgoISO(8), credentialCount: 2, workflows: [wf('a-b-c')] }),
    /⚠️ .*稼働確認が 8 日前/],
  ['観測14日超で🚨',
    fixture('stale14', { observedAt: daysAgoISO(20), credentialCount: 2, workflows: [wf('a-b-c')] }),
    /🚨 .*稼働確認が 20 日行われていない/],
  ['active でも自動実行が無ければ🚨',
    fixture('silent', { observedAt: daysAgoISO(0), credentialCount: 2, workflows: [wf('a-b-c', { lastAutoExecutionAt: null })] }),
    /🚨 .*自動実行の履歴が1件もない/],
  ['active でも自動実行が3日以上前なら🚨',
    fixture('stalerun', { observedAt: daysAgoISO(0), credentialCount: 2, workflows: [wf('a-b-c', { lastAutoExecutionAt: daysAgoISO(5) })] }),
    /🚨 .*自動実行が 5 日間ない/],
  ['認証0件なら🚨',
    fixture('nocred', { observedAt: daysAgoISO(0), credentialCount: 0, workflows: [wf('a-b-c')] }),
    /🚨 .*認証情報が0件/],
  ['demo- は稼働対象に数えない',
    fixture('demo', { observedAt: daysAgoISO(0), credentialCount: 2, workflows: [wf('demo-x', { active: false, lastAutoExecutionAt: null })] }),
    /稼働対象のワークフローが0本/],

  // ── 2026-08-01 N8N-D01: 構造的な誤警報2種の回帰テスト ─────────────
  // どちらも「実行履歴0」だが正常。閾値を緩めるのではなく、実行0の意味を
  // トリガー種別で分けることで解消した（検知力を落とさないことが要件）。
  ['定期: 週1トリガーの有効化直後は鳴らない（猶予内）',
    fixture('grace-in', { observedAt: daysAgoISO(0), credentialCount: 2,
      workflows: [wf('market-watch-page-reachability', { triggerKind: 'schedule', expectedIntervalHours: 168, lastAutoExecutionAt: null, updatedAt: hoursAgoISO(2) })] }),
    /稼働対象 1 本すべて正常/, 'quiet'],
  ['定期: 期待間隔×1.5を過ぎたら🚨（猶予は無限ではない）',
    fixture('grace-out', { observedAt: daysAgoISO(0), credentialCount: 2,
      workflows: [wf('market-watch-page-reachability', { triggerKind: 'schedule', expectedIntervalHours: 168, lastAutoExecutionAt: null, updatedAt: daysAgoISO(15) })] }),
    /🚨 .*自動実行の履歴が1件もない.*期待間隔 168時間/],
  ['定期: 短周期WFは1回の取りこぼしでは鳴らない（floor 6時間）',
    fixture('floor-in', { observedAt: daysAgoISO(0), credentialCount: 2,
      workflows: [wf('ops-notify-failure', { triggerKind: 'schedule', expectedIntervalHours: 2, lastAutoExecutionAt: hoursAgoISO(4) })] }),
    /稼働対象 1 本すべて正常/, 'quiet'],
  ['定期: 短周期WFでも沈黙が続けば🚨',
    fixture('floor-out', { observedAt: daysAgoISO(0), credentialCount: 2,
      workflows: [wf('ops-notify-failure', { triggerKind: 'schedule', expectedIntervalHours: 2, lastAutoExecutionAt: hoursAgoISO(9) })] }),
    /🚨 .*期待間隔 2時間/],
  ['イベント: 自動実行0でも鳴らない（Gmailポーリングは該当メールが来た時しか実行を作らない）',
    fixture('event-ok', { observedAt: daysAgoISO(0), credentialCount: 2,
      workflows: [wf('asp-detect-approval-mail', { triggerKind: 'event', lastAutoExecutionAt: null, lastExecutionAt: daysAgoISO(1) })] }),
    /イベント 1本=待機中/, 'quiet'],
  ['イベント: 一度も通し実行の形跡が無ければ⚠️（🚨には上げない）',
    fixture('event-never', { observedAt: daysAgoISO(0), credentialCount: 2,
      workflows: [wf('asp-detect-approval-mail', { triggerKind: 'event', lastAutoExecutionAt: null, lastExecutionAt: null })] }),
    /⚠️ .*実行された形跡が1件もない/],
];

let pass = 0, fail = 0;
for (const [label, file, expect, quiet] of cases) {
  const lines = n8nLines(file);
  const ok = lines.some((l) => expect.test(l));
  // 正常系は「異常が1件も出ていない」ことまで確かめる（ℹ️行が出るだけでは不十分）。
  const clean = quiet !== 'quiet' || !lines.some((l) => l.startsWith('🚨') || l.startsWith('⚠️'));
  if (ok && clean) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n     期待: ${expect}${quiet === 'quiet' ? '（かつ🚨/⚠️ゼロ）' : ''}\n     実際: ${lines.join('\n           ') || '(n8n行なし)'}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);

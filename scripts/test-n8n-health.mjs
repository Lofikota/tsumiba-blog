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
const wf = (name, over = {}) => ({ id: name, name, active: true, triggerCount: 1, lastAutoExecutionAt: daysAgoISO(0), updatedAt: daysAgoISO(0), ...over });

// ops-doctor は他チェックの結果で終了コードが変わるので、判定はn8n行の本文で行う。
// --no-net で git fetch を省き、テストをオフラインでも安定させる。
function n8nLines(statusFile) {
  let out;
  try {
    out = execFileSync('node', [DOCTOR, '--no-net'], {
      encoding: 'utf-8',
      env: { ...process.env, N8N_STATUS_FILE: statusFile },
    });
  } catch (e) {
    out = e.stdout ?? '';   // 🚨があると exit 2 で throw する。出力自体は正常
  }
  return out.split('\n').filter((l) => /n8n/i.test(l));
}

function fixture(name, snapshot) {
  const f = path.join(tmp, `${name}.json`);
  fs.writeFileSync(f, snapshot === null ? 'not json{' : JSON.stringify(snapshot));
  return f;
}

const cases = [
  ['ファイル不在なら🚨', path.join(tmp, 'nope.json'), /スナップショットが無い/],
  ['壊れたJSONなら🚨', fixture('broken', null), /壊れている/],
  ['形式不正なら🚨', fixture('shape', { observedAt: daysAgoISO(0) }), /形式が不正/],
  ['正常なら🚨も⚠️も出さない',
    fixture('green', { observedAt: daysAgoISO(1), credentialCount: 2, workflows: [wf('asp-detect-approval-mail')] }),
    /すべて active・自動実行あり/],
  ['観測7日超で⚠️',
    fixture('stale7', { observedAt: daysAgoISO(8), credentialCount: 2, workflows: [wf('a-b-c')] }),
    /稼働確認が 8 日前/],
  ['観測14日超で🚨',
    fixture('stale14', { observedAt: daysAgoISO(20), credentialCount: 2, workflows: [wf('a-b-c')] }),
    /稼働確認が 20 日行われていない/],
  ['active でも自動実行が無ければ🚨',
    fixture('silent', { observedAt: daysAgoISO(0), credentialCount: 2, workflows: [wf('a-b-c', { lastAutoExecutionAt: null })] }),
    /自動実行の履歴が1件もない/],
  ['active でも自動実行が3日以上前なら🚨',
    fixture('stalerun', { observedAt: daysAgoISO(0), credentialCount: 2, workflows: [wf('a-b-c', { lastAutoExecutionAt: daysAgoISO(5) })] }),
    /自動実行が 5 日間ない/],
  ['認証0件なら🚨',
    fixture('nocred', { observedAt: daysAgoISO(0), credentialCount: 0, workflows: [wf('a-b-c')] }),
    /認証情報が0件/],
  ['demo- は稼働対象に数えない',
    fixture('demo', { observedAt: daysAgoISO(0), credentialCount: 2, workflows: [wf('demo-x', { active: false, lastAutoExecutionAt: null })] }),
    /稼働対象のワークフローが0本/],
];

let pass = 0, fail = 0;
for (const [label, file, expect] of cases) {
  const lines = n8nLines(file);
  const ok = lines.some((l) => expect.test(l));
  // 正常系は「異常が1件も出ていない」ことまで確かめる（ℹ️行が出るだけでは不十分）。
  // 正常時のℹ️行にも「自動実行あり」の語が入るので、異常側の文言だけを列挙して照合する。
  const BAD = /停止中|認証情報が0件|自動実行の履歴が1件もない|自動実行が \d+ 日間ない|稼働確認が|スナップショット/;
  const clean = !label.startsWith('正常') || !lines.some((l) => BAD.test(l));
  if (ok && clean) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n     期待: ${expect}\n     実際: ${lines.join('\n           ') || '(n8n行なし)'}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);

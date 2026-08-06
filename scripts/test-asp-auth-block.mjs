#!/usr/bin/env node
/**
 * test-asp-auth-block.mjs — ops-doctor §11（ASP認証ブロックの継続）の分岐テスト
 *
 * なぜ要るか: 本番の状態正本は現在「blocked_auth 2件」で🚨側しか通らない。
 * 「解消したら鳴りやむ」「閾値未満では鳴らない」は、本番では詰まりが解けるまで一度も実行されない。
 * 未実行のまま出荷すると、鳴りっぱなしで形骸化するか、鳴るはずのアラームが鳴らないかのどちらかになる
 * ＝検知装置そのものの沈黙障害（test-n8n-health.mjs と同じ理由）。
 *
 * ⚠️ 本番の asp_revenue_funnel_*.json は読まない・書かない。全ケースがtmpのfixture。
 *
 * 実行: node scripts/test-asp-auth-block.mjs
 * 注入口: ASP_FUNNEL_STATE_DIR（§6-3 の ROOTDOCS_DIR と同じ <対象>_<用途> 規約）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCTOR = path.join(__dirname, 'ops-doctor.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asp-auth-'));

const ymdAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

// 実データと同じ形（AI運用/データ正本/asp_revenue_funnel_2026-08-01.json より）。
const catalog = [{ offer_id: 'matsui_fx_vc', asp_id: 'valuecommerce' }];
const app = (over = {}) => ({
  application_id: 'app_tsumiba__matsui_fx_vc',
  site_id: 'tsumiba',
  offer_id: 'matsui_fx_vc',
  status: 'blocked_auth',
  blocker: 'asp_login',
  authorized_at: ymdAgo(6),
  last_attempt_at: ymdAgo(0),   // 詰まっている間むしろ「今日」に更新される（実データ: 08-06→08-07）
  submitted_at: null,
  ...over,
});
const state = (queue, over = {}) => ({ schema_version: 1, program_catalog: catalog, application_queue: queue, ...over });

// ops-doctor は他チェックの結果で終了コードが変わるので、判定は §11 の行の本文で行う。
// --no-net で git fetch と本番HTTPを省き、テストをオフラインでも安定させる。
function run(dir) {
  try {
    return execFileSync('node', [DOCTOR, '--no-net'], {
      encoding: 'utf-8',
      env: { ...process.env, ASP_FUNNEL_STATE_DIR: dir },
    });
  } catch (e) {
    return e.stdout ?? '';   // 🚨があると exit 2 で throw する。出力自体は正常
  }
}

// checkAspAuthBlock のメッセージは必ず "ASP認証" で始まる契約。箇条書きの先頭で所属を判定し、
// その続き（→ で始まる継続行）を同じ深刻度で拾う。深刻度を落とすと「🚨か⚠️か」が検証できない。
function aspLines(dir) {
  const rows = [];
  let sev = '', inAsp = false;
  for (const line of run(dir).split('\n')) {
    const head = ['🚨', '⚠️', 'ℹ️'].find((s) => line.startsWith(s));
    if (head) { sev = head; inAsp = false; continue; }
    const bullet = line.match(/^\s*-\s(.*)$/);
    if (bullet) {
      inAsp = /^ASP認証/.test(bullet[1]);
      if (inAsp) rows.push(`${sev} ${bullet[1]}`);
      continue;
    }
    if (inAsp && line.trim()) rows.push(`${sev} ${line.trim()}`);
  }
  return rows;
}

// 1ケース = 1ディレクトリ（状態正本は「prefix一致で名前が最大のもの」を選ぶため、混ぜると干渉する）
function fixture(name, ...files) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of files) {
    fs.writeFileSync(path.join(dir, file), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

const F = (name, body, file = 'asp_revenue_funnel_2026-08-01.json') => fixture(name, [file, body]);

// quiet:'quiet' は「🚨も⚠️も1行も出ない」ことまで確かめる。
// 期待文言が出るだけでは不十分で、別の誤警報が同時に出ていないことが本質。
const cases = [
  ['3日以上の継続で🚨',
    F('crit', state([app({ authorized_at: ymdAgo(6) })])),
    /🚨 ASP認証ブロックが 6 日継続.*valuecommerce.*blocker=asp_login/],

  ['🚨には人間タスク（何をする/どうなる/手順/完了確認）が付く',
    F('crit-fix', state([app({ authorized_at: ymdAgo(6) })])),
    /🚨 .*Claude アイコンからサイドパネル.*Sign in.*3経路が同時に開く.*完了確認/s],

  // 本チケットの当初案（last_attempt_at からの経過日数で判定）だと、詰まっている間ずっと
  // last_attempt_at が今日へ更新されるため永久に0日＝一度も鳴らない。その退行を固定する。
  ['最終試行が今日でも🚨は出る（last_attempt_at起点への退行ガード）',
    F('anchor', state([app({ authorized_at: ymdAgo(30), last_attempt_at: ymdAgo(0) })])),
    /🚨 ASP認証ブロックが 30 日継続/],

  ['閾値未満（2日）では🚨も⚠️も出さない',
    F('under', state([app({ authorized_at: ymdAgo(2) })])),
    /ASP認証ブロック 2日目.*3日で🚨に上がる/, 'quiet'],

  ['解消済み（submitted）なら発火しない',
    F('resolved', state([app({ status: 'submitted', submitted_at: ymdAgo(0), blocker: null })])),
    /ASP認証ブロック: なし（application_queue 1件）/, 'quiet'],

  ['承認待ちへ進んだ状態でも発火しない',
    F('approved', state([app({ status: 'awaiting_approval', submitted_at: ymdAgo(1), blocker: null })])),
    /ASP認証ブロック: なし/, 'quiet'],

  ['キューが空なら発火しない',
    F('empty', state([])),
    /ASP認証ブロック: なし（application_queue 0件）/, 'quiet'],

  ['同一ASP×同一blockerの複数件は1件の🚨に束ねる（最古の日数で判定）',
    F('grouped', state([
      app({ application_id: 'app_a', authorized_at: ymdAgo(4) }),
      app({ application_id: 'app_b', authorized_at: ymdAgo(9) }),
    ])),
    /🚨 ASP認証ブロックが 9 日継続.*対象 2件.*app_a \/ app_b/],

  ['asp_login 以外のblockerは汎用の復旧文面で🚨',
    F('other-blocker', state([app({ blocker: 'site_review_pending', authorized_at: ymdAgo(10) })])),
    /🚨 .*blocker=site_review_pending[\s\S]*状態正本の application_queue と直近の実施記録/],

  ['日付が1つも無ければ⚠️（滞留を数えられないこと自体が異常）',
    F('nodate', state([app({ authorized_at: null, last_attempt_at: null })])),
    /⚠️ ASP認証ブロック 1件.*経過日数を測る日付/],

  ['壊れたJSONなら🚨',
    F('broken', 'not json{'),
    /🚨 ASP認証ブロックの検査に失敗/],

  ['状態正本が1つも無ければ⚠️',
    fixture('nofile', ['README.md', '# 状態正本ではないファイル']),
    /⚠️ ASP認証ブロックの検査を実行できない/],

  ['ディレクトリごと無いマシンでは鳴らさない',
    path.join(tmp, 'does-not-exist'),
    /ASP認証ブロック: 状態正本のディレクトリ未検出/, 'quiet'],

  // ファイル名の日付をハードコードすると、次の版を作った日から静かに古い値を読み続ける。
  ['複数版があれば日付が新しい方を読む',
    fixture('multi',
      ['asp_revenue_funnel_2026-08-01.json', state([app({ authorized_at: ymdAgo(6) })])],
      ['asp_revenue_funnel_2026-09-01.json', state([app({ status: 'submitted', submitted_at: ymdAgo(0) })])]),
    /ASP認証ブロック: なし/, 'quiet'],
];

let pass = 0, fail = 0;
for (const [label, dir, expect, quiet] of cases) {
  const lines = aspLines(dir);
  const ok = lines.some((l) => expect.test(l)) || expect.test(lines.join('\n'));
  const clean = quiet !== 'quiet' || !lines.some((l) => l.startsWith('🚨') || l.startsWith('⚠️'));
  if (ok && clean) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n     期待: ${expect}${quiet === 'quiet' ? '（かつ🚨/⚠️ゼロ）' : ''}\n     実際: ${lines.join('\n           ') || '(ASP認証行なし)'}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);

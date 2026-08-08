#!/usr/bin/env node
/**
 * ops-doctor.mjs — 事業システムの沈黙障害を検知するヘルスチェック
 *
 * 背景: 2026-06-14〜07-02 の18日間、daily-article.yml がキュー検証失敗で
 * 毎日死んでいたのに誰も気づかなかった。この種の「沈黙障害」を
 * セッション開始時に1コマンドで検出するための診断スクリプト。
 *
 * 使い方:
 *   node scripts/ops-doctor.mjs           # 全チェック実行
 *   node scripts/ops-doctor.mjs --no-net  # ネットワーク不要のチェックのみ
 *
 * 読み取り専用（git fetch 以外に状態を変更しない）。認証情報不要。
 * 終了コード: 0=正常 / 1=警告あり / 2=要対応（🚨）あり
 */
import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveAffiliateRoot } from './lib/affiliate-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AFFILIATE_ROOT = resolveAffiliateRoot(ROOT);
const REPO_API = 'https://api.github.com/repos/Lofikota/tsumiba-blog';
const noNet = process.argv.includes('--no-net');

const critical = [];
const warnings = [];
const infos = [];

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
const daysAgo = (date) => Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
const hoursAgo = (date) => (Date.now() - new Date(date).getTime()) / 3600000;

// ── 1. git状態（未push・未commit・staleロック）──────────────────
function checkGit() {
  if (!noNet) {
    try { sh('git fetch origin main --quiet'); } catch { warnings.push('git fetch に失敗（オフライン？）。ahead/behind は古い情報の可能性。'); }
  }
  const ahead = Number(sh('git rev-list --count origin/main..HEAD'));
  const behind = Number(sh('git rev-list --count HEAD..origin/main'));
  if (ahead > 0) critical.push(`未pushコミットが ${ahead} 件ある。成果物が埋もれる前に push すること（6/15・7/2 に発生した事故と同型）。`);
  if (behind > 0) warnings.push(`origin より ${behind} コミット遅れ。CMS編集の可能性 → git pull --rebase 推奨。`);

  checkUncommitted();

  // git worktree では .git は「gitdirへのポインタを書いたファイル」でディレクトリではない。
  // readdirSync が ENOTDIR で throw し doctor 全体が落ちていた（診断が診断できない沈黙障害）。
  // ロック残骸の検知はメインの作業ツリーで足りるので、worktree では飛ばす。
  const gitDir = path.join(ROOT, '.git');
  const locks = fs.statSync(gitDir).isDirectory()
    ? fs.readdirSync(gitDir).filter((f) => f.includes('.lock'))
    : [];
  if (locks.length) warnings.push(`staleなgitロックが ${locks.length} 件（Coworkサンドボックス残骸の可能性）: ${locks.join(', ')}`);

  const lastOrigin = sh('git log -1 --format=%ci origin/main');
  const age = daysAgo(lastOrigin);
  if (age >= 3) critical.push(`origin/main が ${age} 日間更新されていない。日次パイプラインが沈黙している疑い。`);
  else infos.push(`origin/main 最終更新: ${age} 日前`);
}

// ── 1-b. 未commit変更（リポジトリ全体・重要度で3段に分ける）─────
// 旧実装は src/content/blog と keyword-queue.json だけを見ており、収益動線の中核
// （src/components・scripts・.github/workflows・package.json）の放置を検知できなかった。
// 全域に広げるとビルド残骸で常時警告が鳴り形骸化するため、重要度で段を分ける。
const UNCOMMITTED_IMPORTANT_STALE_DAYS = 3;
const IMPORTANT_PREFIXES = ['src/', 'scripts/', '.github/workflows/'];
const IMPORTANT_FILES = ['package.json', 'package-lock.json'];
// ビルド残骸: 成果物ではなく掃除対象。commit催促ではなく削除/ignore を促す。
const BUILD_RESIDUE = [/^astro\.config\..*tmp\.mjs$/, /^_t\.tmp$/, /^\.astro_old_/];

// porcelain 1行 → { status, file, untracked }。rename は新パス側を採る。
function parsePorcelain(line) {
  const status = line.slice(0, 2);
  let file = line.slice(3);
  if (file.includes(' -> ')) file = file.split(' -> ').pop();
  if (file.startsWith('"') && file.endsWith('"')) file = JSON.parse(file);
  return { status: status.trim(), file, untracked: status === '??' };
}

// 未commit変更は git 側に日付を持たないため、経過日数の唯一のソースは mtime。
function fileAgeDays(file) {
  try {
    return Math.floor((Date.now() - fs.statSync(path.join(ROOT, file.replace(/\/$/, ''))).mtimeMs) / 86400000);
  } catch { return null; }
}

const isImportant = (f) => IMPORTANT_PREFIXES.some((p) => f.startsWith(p)) || IMPORTANT_FILES.includes(f);
const isResidue = (f) => BUILD_RESIDUE.some((re) => re.test(f));
const fmt = (items) => items.map(({ file, age }) => `      ${file}${age === null ? '' : `（${age}日）`}`).join('\n');

function checkUncommitted() {
  // sh() は trim() するが、porcelain は先頭カラムが有意なスペース（' M' = worktree変更）。
  // 全体 trim すると1行目だけ1文字ズレてパスと状態が壊れるため、末尾改行だけ落とす。
  const raw = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf-8' }).replace(/\n+$/, '');
  if (!raw) { infos.push('未commitの変更なし。'); return; }

  const entries = raw.split('\n').map(parsePorcelain)
    .map((e) => ({ ...e, age: fileAgeDays(e.file) }))
    .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));

  const residue = entries.filter((e) => isResidue(e.file));
  const rest = entries.filter((e) => !isResidue(e.file));
  const staleImportant = rest.filter((e) => isImportant(e.file) && (e.age ?? 0) >= UNCOMMITTED_IMPORTANT_STALE_DAYS);
  const other = rest.filter((e) => !staleImportant.includes(e));

  if (staleImportant.length) {
    critical.push(`重要ファイルに ${UNCOMMITTED_IMPORTANT_STALE_DAYS} 日以上未commitの変更が ${staleImportant.length} 件（src/・scripts/・.github/workflows/・package.json）。成果物が消える・本番と乖離する:\n${fmt(staleImportant)}`);
  }
  if (other.length) {
    const untrackedCount = other.filter((e) => e.untracked).length;
    warnings.push(`その他の未commit ${other.length} 件（うち未追跡 ${untrackedCount} 件）:\n${fmt(other)}`);
  }
  if (residue.length) {
    warnings.push(`掃除候補（ビルド残骸・一時ファイル）${residue.length} 件。commitではなく削除、または .gitignore へ追加すること:\n${fmt(residue)}\n      → rm -rf ${residue.map((e) => e.file).join(' ')}`);
  }

  const untrackedMdx = entries.filter((e) => e.untracked && e.file.endsWith('.mdx'));
  if (untrackedMdx.length) critical.push(`未追跡の記事ファイル ${untrackedMdx.length} 件。commitされない限り存在しないのと同じ: ${untrackedMdx.map((e) => e.file).join(', ')}`);
}

// ── 2. GitHub Actions 実行結果（公開APIのみ・認証不要）──────────
async function checkActions() {
  if (noNet) return;
  // kpi-update.yml は手動入力専用(workflow_dispatchのみ)のため監視対象外（実行0件が正常）
  // affiliate-link-check.yml は 2026-07-30 OPS-RED4 で追加。リポジトリ13本のうち schedule が
  // 生きている＝自動発火する唯一のワークフローであり、「cronが発火しなくなった」型は
  // ops-notify-failure(n8n) の非対象（N8N-W2実施記録 §5-2）＝ここでしか検知できない。
  // 7/26からの9連続失敗が6日間見逃されたのは、これが監視4本の外にあったため（同 §6 補足）。
  const workflows = ['daily-article.yml', 'x-post.yml', 'x-generate.yml', 'weekly-kpi.yml', 'affiliate-link-check.yml'];
  // Phase 0 (2026-07-11): scheduleを削除して意図停止中（正本: AI運用/戦略/媒体修復実行計画_2026-07-11.md、
  // 停止コミット: 95eeb3c〜039f6ae）。発火しないため過去runの失敗履歴は監視しない（新runが来ない限り
  // 「直近5回失敗」が永久に残り、偽の🚨になるため）。Phase 0解除で自動化を再開する時はここから外すこと。
  const paused = ['daily-article.yml', 'x-generate.yml', 'weekly-kpi.yml'];
  // ── ここに asp-check / article-image-gen / competitor-monitor / seo-improvement を足さない理由 ──
  // （2026-07-30 OPS-RED4で判断済み。再調査を防ぐために結論を残す）
  // 4本とも 2026-07-11 に schedule を削除して意図停止中で、7/6〜7/11の赤は停止前の最後のrunの残骸。
  // 新runが発生しないため、監視対象に足すと上記 paused と同じ「永久に消えない偽の🚨」になる。
  // かつ4本の処遇は各ワークフローファイル冒頭のコメントで確定済み（直す=asp-check / 廃止扱い=他3本）。
  // 「起動して失敗した」型は ops-notify-failure(n8n) が全ワークフローを見るため、ここでの重複は不要。
  // → Phase 0 を解除して schedule を戻すワークフローが出た時だけ、上の workflows 配列へ足すこと。
  for (const wf of workflows) {
    if (paused.includes(wf)) {
      infos.push(`${wf}: Phase 0停止中（schedule削除済み・手動実行のみ）`);
      continue;
    }
    try {
      const res = await fetch(`${REPO_API}/actions/workflows/${wf}/runs?per_page=5`);
      if (!res.ok) { warnings.push(`${wf}: 実行履歴を取得できない (HTTP ${res.status})`); continue; }
      const runs = (await res.json()).workflow_runs ?? [];
      if (!runs.length) { warnings.push(`${wf}: 実行履歴が0件`); continue; }
      const failures = runs.filter((r) => r.conclusion === 'failure').length;
      const latest = runs[0];
      if (latest.conclusion === 'failure' && failures >= 3) {
        const hint = wf === 'x-generate.yml'
          ? ' 応急処置: このMacで npm run x:sync-d1（wrangler OAuthでD1同期。GitHub Secret不要）。恒久対応: CLOUDFLARE_API_TOKEN 再発行。'
          : '';
        critical.push(`${wf}: 直近${runs.length}回中${failures}回失敗（最新: ${latest.created_at.slice(0, 10)}）。連続失敗＝沈黙障害。ログ: ${latest.html_url}${hint}`);
      } else if (latest.conclusion === 'failure') {
        warnings.push(`${wf}: 最新実行が失敗（${latest.created_at.slice(0, 10)}）。ログ: ${latest.html_url}`);
      } else {
        infos.push(`${wf}: 最新実行 ${latest.conclusion}（${latest.created_at.slice(0, 10)}）`);
      }
    } catch (e) {
      warnings.push(`${wf}: API接続失敗（${e.message}）`);
    }
  }
}

// ── 3. keyword-queue と記事ファイルの整合性 ─────────────────────
function checkQueue() {
  const queuePath = path.join(ROOT, 'data/keyword-queue.json');
  const blogDir = path.join(ROOT, 'src/content/blog');
  const q = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  const items = Array.isArray(q) ? q : (q.keywords ?? q.queue ?? []);
  const counts = {};
  for (const it of items) counts[it.status] = (counts[it.status] ?? 0) + 1;
  // ラベルは「キュー」単独にしない。同じ画面に X投稿キューの行が並ぶため、記事生成の在庫を
  // X投稿の在庫と読み違える事故が起きていた（2026-08-08 X-QUEUE-01）。実体のパスまで書く。
  infos.push(`記事生成キュー（data/keyword-queue.json）: ${items.length}件（${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' / ')}）`);

  for (const it of items) {
    const file = path.join(blogDir, `${it.slug}.mdx`);
    const exists = fs.existsSync(file);
    if (it.status === 'pending' && exists) critical.push(`queue不整合: ${it.slug} は pending だが記事が存在 → 二重生成される。statusを修正すること。`);
    if (it.status === 'published' && !exists) warnings.push(`queue不整合: ${it.slug} は published だが記事ファイルがない。`);
  }
  const pendingCount = counts.pending ?? 0;
  if (pendingCount === 0) warnings.push('pendingが0件。日次記事生成が明日から止まる。キーワード補充が必要。');
  else if (pendingCount <= 3) warnings.push(`pendingが残り${pendingCount}件。数日でキーワード切れ → refill-keyword-queue.mjs で補充を検討。`);
}

// ── 3-2. X投稿経路の可用性（X-AVAIL-01 2026-07-25）────────────────
// 背景: 2026-07-22に再開したlaunchd投稿経路が、StartIntervalのspawnをlaunchdに
// 保留され続けて 7/23=1回・7/24=0回しか起動せず、D2(id280)・D3(id281)が
// 「投稿されなかった」のではなく「投稿処理が一度も起動しなかった」まま期限切れした。
// 結果だけ見ると suspended が増えるだけで、原因も損失も画面のどこにも出ない典型的な沈黙障害。
// 検知を3層で置く: ①取りこぼし本体 ②経路の死活 ③設定の退行。
// 3つのパスは判定ロジックを fixture で検証できるよう環境変数で差し替え可能にする
// （checkBackupTarget の AIOPS_BACKUP_LOG と同じ規約）。検証: X自動化/test_ops_doctor_x.sh
const X_AUTOMATION_DIR = path.join(AFFILIATE_ROOT, 'X自動化');
const X_QUEUE_CSV = process.env.X_QUEUE_CSV || path.join(X_AUTOMATION_DIR, 'data/tweet_queue.csv');
const X_POSTER_LOG = process.env.X_POSTER_LOG || path.join(X_AUTOMATION_DIR, 'logs/launchd_stderr.log');
const X_PLIST = process.env.X_PLIST || path.join(process.env.HOME || '', 'Library/LaunchAgents/com.tsumiba.xposter.plist');
const X_CATCH_UP_HOURS = 48;  // x_poster.py の CATCH_UP_HOURS と一致させること
const X_LOG_WARN_HOURS = 14;  // 一晩のスリープ(約10-12h)では鳴らさない
const X_LOG_CRIT_HOURS = 30;  // 丸1日以上起動していない = 経路が死んでいる
const X_PENDING_WARN = 3;     // これを下回ったら補充のリードタイムが足りない（承認は人が押すため即日補充できない）
const X_SILENT_CRIT_HOURS = 72;  // 在庫ゼロがこの時間続いたら「たまたま切れた」ではなく供給が止まっている

// tweet_queue.csv は本文に改行とカンマを含むためスプリットでは壊れる。最小限のCSVパーサ。
function readTweetQueue(file) {
  const raw = fs.readFileSync(file, 'utf-8');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"') { if (raw[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.length >= header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function checkXPostAvailability() {
  if (!fs.existsSync(X_QUEUE_CSV)) { infos.push('X投稿キュー: 未検出（X自動化/ がないマシン）'); return; }

  // ① 取りこぼし本体: pending なのに予定時刻を過ぎている行
  const now = Date.now();
  const overdue = [];
  for (const r of readTweetQueue(X_QUEUE_CSV)) {
    if (r.status !== 'pending') continue;
    const t = new Date(`${r.scheduled_date}T${r.scheduled_time}:00`).getTime();
    if (Number.isNaN(t) || t >= now) continue;
    overdue.push({ id: r.id, at: `${r.scheduled_date} ${r.scheduled_time}`, hours: (now - t) / 3600000 });
  }
  const lost = overdue.filter((o) => o.hours > X_CATCH_UP_HOURS);
  const late = overdue.filter((o) => o.hours <= X_CATCH_UP_HOURS);
  const fmtOverdue = (l) => l.map((o) => `id=${o.id}（${o.at} / ${Math.floor(o.hours)}時間超過）`).join(' / ');
  if (lost.length) {
    critical.push(`X投稿の取りこぼし ${lost.length} 件: ${fmtOverdue(lost)}\n      → catch-up窓(${X_CATCH_UP_HOURS}時間)を超えており、放置すると投稿されないまま消える。投稿するか suspended にするか判断すること。`);
  }
  if (late.length) {
    warnings.push(`X投稿が予定時刻を過ぎたまま ${late.length} 件: ${fmtOverdue(late)}\n      → catch-up窓の内側。次のジョブ起動で投稿される見込み。連続するなら投稿経路を疑う。`);
  }

  // ② 経路の死活: 投稿スクリプトが最後に起動した時刻
  if (fs.existsSync(X_POSTER_LOG)) {
    const hits = fs.readFileSync(X_POSTER_LOG, 'utf-8').match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ \[INFO\] === X投稿スクリプト起動/gm);
    const last = hits?.at(-1)?.slice(0, 19);
    if (!last) {
      warnings.push('X投稿スクリプトの起動ログが1件もない。ジョブが一度も動いていない可能性。');
    } else {
      const h = (now - new Date(last.replace(' ', 'T')).getTime()) / 3600000;
      if (h > X_LOG_CRIT_HOURS) critical.push(`X投稿スクリプトが ${Math.floor(h)} 時間起動していない（最終 ${last}）。投稿経路が停止＝X流入がゼロのまま気づけない。\n      → launchctl print gui/501/com.tsumiba.xposter で state と runs を確認すること。`);
      else if (h > X_LOG_WARN_HOURS) warnings.push(`X投稿スクリプトの最終起動が ${Math.floor(h)} 時間前（${last}）。Macの停止時間が長いか、ジョブが保留されている。`);
      else infos.push(`X投稿ジョブ: 最終起動 ${last}（${Math.floor(h)}時間前）`);
    }
  }

  // ③ 設定の退行ガード: StartInterval へ戻されたら鳴らす。
  // このMacでは StartInterval のspawnがlaunchdに保留され続ける（実測: 1日約11時間の起動に対し
  // 5分間隔ジョブが0〜1回しか動かない。同条件の StartCalendarInterval ジョブは正常発火）。
  // plistのコメントは人間が読まないと効かないので、検査をコード側に置く。
  if (fs.existsSync(X_PLIST)) {
    const plist = fs.readFileSync(X_PLIST, 'utf-8');
    if (/^\s*<key>StartInterval<\/key>/m.test(plist)) {
      critical.push('com.tsumiba.xposter.plist が StartInterval に戻っている。このMacではStartIntervalのspawnがlaunchdに保留され、実測で1日0〜1回しか動かない（X-AVAIL-01）。\n      → StartCalendarInterval（毎時 :00/:30）へ戻すこと。正本: AI運用/戦略/X集客/X投稿可用性修復_X-AVAIL-01_2026-07-25.md');
    } else if (!/StartCalendarInterval/.test(plist)) {
      warnings.push('com.tsumiba.xposter.plist にスケジュール指定（StartCalendarInterval）が見当たらない。ジョブが自動起動しない。');
    }
  }

  // ④ 弾切れ: 投稿する在庫そのものが尽きている（N8N-X04・2026-08-08 追加）
  // ①は「pendingがあるのに投稿されていない」を見る検査で、在庫がある前提に立っている。
  // pending=0 のとき①は言うことが無いので**必ず沈黙する**。
  // 実害: 2026-08-05 19:00 を最後に pending が0本になり、投稿処理は毎30分正常に起動して
  // 「投稿予定ツイートなし」とログに書いて終了し続けた。3日間X流入がゼロでも誰にも鳴らなかった。
  // 取りこぼし（在庫はあるが出ない）と弾切れ（在庫が無い）は別の観測量なので、別に数える。
  const rows = readTweetQueue(X_QUEUE_CSV);
  const pendingRows = rows.filter((r) => r.status === 'pending');
  const postedAts = rows
    .filter((r) => r.status === 'posted' && r.posted_at)
    .map((r) => new Date(r.posted_at.replace(' ', 'T')).getTime())
    .filter((t) => !Number.isNaN(t));
  const lastPostedAt = postedAts.length ? Math.max(...postedAts) : null;
  const silentHours = lastPostedAt === null ? Infinity : (now - lastPostedAt) / 3600000;
  const silentText = lastPostedAt === null
    ? '投稿実績が1件もない'
    : `最後の投稿から ${Math.floor(silentHours)} 時間経過`;

  if (pendingRows.length === 0 && silentHours > X_SILENT_CRIT_HOURS) {
    critical.push(`X投稿キューが弾切れ: pending 0本・${silentText}。投稿処理は正常に起動しているが、出すタマが無いまま止まっている＝X流入がゼロ。\n      → 補充経路: n8n quality-dojo-loop（合格品を x_draft_queue へ）→ 毎朝07:00の承認メールでボタンを押す → X自動化/pull_n8n_drafts.py が回収。手動なら X自動化/add_tweet.py。\n      → 補充の詰まりどころを見るとき: tail -20 X自動化/logs/pull_n8n_drafts.log`);
  } else if (pendingRows.length < X_PENDING_WARN) {
    warnings.push(`X投稿キューの残りが ${pendingRows.length} 本（${silentText}）。${X_PENDING_WARN}本を切ると数日で弾切れになる。\n      → 朝の承認メールに未処理が溜まっていないか、n8n の x_draft_queue に pending_review が残っていないかを見ること。`);
  } else {
    infos.push(`X投稿キューの残り: ${pendingRows.length} 本（${silentText}）`);
  }
}

// ── 3-2. n8nワークフローの稼働（N8N-G01・2026-08-01）────────────
// 2026-07-29に構築した本番WF4本が、3日間 active:false / 認証情報0件 / 実行0 のまま
// 「構築完了」として扱われていた。asp-detect-approval-mail はASP提携承認メールの検知＝
// 収益ファネルの主ボトルネックの監視装置で、止まっている間は承認メールが届いても気づけない。
//
// なぜ n8n を直接見に行かないか: n8n Cloud の状態を読むには Public API キー（X-N8N-API-KEY）
// の新設が要り、境界定義§4-2「秘密情報の金庫を2つにしない」に抵触する。
// n8n MCP は OAuth 接続でキー不要だが、**Claude Code のセッション内からしか呼べない**。
// つまり遠隔の状態そのものはスクリプトから原理的に観測できない。
//
// 代わりに観測するのは「**観測が行われた事実の鮮度**」。MCPを持つセッションが残した
// スナップショットを読み、①異常な状態が写っていれば鳴らす ②スナップショット自体が
// 古ければ「誰も見ていない」として鳴らす。X投稿ログの最終起動時刻(§3)・正本ミラーの
// 差分日数(§6-3)と同じ、痕跡の古さで死活を判定する型。
//
// active:true だけでは不十分な理由: 実測した13実行はすべて mode:"manual"（AIのテスト実行）
// だった。active は「動くはずだ」という**主張**で、trigger実行の履歴だけが**証拠**になる。
// 正本: AI運用/n8n稼働検知の設計_2026-08-01.md ／ AI運用/n8n-MCP実行学習_2026-08-01.md §1-1
const N8N_STATUS_FILE = process.env.N8N_STATUS_FILE
  || path.join(AFFILIATE_ROOT, 'AI運用', 'n8n-workflows', '_status', 'latest.json');
const N8N_STATUS_POLICY_FILE = path.join(AFFILIATE_ROOT, 'AI運用', 'n8n-workflows', '_status', 'policy.json');
const N8N_SNAPSHOT_WARN_DAYS = 7;    // 週1回は見に行く想定。超えたら注意
const N8N_SNAPSHOT_CRIT_DAYS = 14;   // 2週間ノーチェックは asp-detect の性質上許容しない
const N8N_NO_RUN_CRIT_DAYS = 3;      // トリガー種別が不明な時の既定。3日 trigger実行が無ければ実質止まっている

// 定期実行の猶予（2026-08-01 N8N-D01）。「まだ発火時刻が来ていない」を異常と呼ばないための係数。
// 1.5＝1回分の取りこぼしは許し、2回連続で来なければ鳴らす。floorは短周期WF（2時間おき等）が
// 単発のネットワーク遅延で鳴かないための下限。どちらも緩めるための数字ではなく、
// 「沈黙が証拠になるまで待つ最小時間」を定義するもの。
const N8N_GRACE_FACTOR = 1.5;
const N8N_GRACE_FLOOR_HOURS = 6;

// 稼働対象の判定。`demo-` 接頭辞は検証用・教材用で、非稼働が正しい状態
// （n8n-MCP実行学習_2026-08-01.md §4 の命名規約）。
const n8nIsProduction = (name) => !name.startsWith('demo-');

const N8N_REFRESH_HOWTO = 'スナップショット更新: n8n MCP の search_workflows / list_credentials / search_executions '
  + '＋ 各ワークフローの get_workflow_details を実行し、'
  + '結果を `node "AI運用/scripts/n8n-status-write.mjs"` に渡す（使い方は同スクリプト冒頭）。';

function checkN8nHealth() {
  if (!fs.existsSync(N8N_STATUS_FILE)) {
    critical.push(`n8nの稼働スナップショットが無い（${N8N_STATUS_FILE}）。n8n Cloud上のワークフローが動いているか誰も確認していない状態。\n      → ${N8N_REFRESH_HOWTO}`);
    return;
  }

  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(N8N_STATUS_FILE, 'utf-8'));
  } catch (e) {
    critical.push(`n8n稼働スナップショットが壊れている（${N8N_STATUS_FILE}）: ${e.message}\n      → ${N8N_REFRESH_HOWTO}`);
    return;
  }
  if (!snap?.observedAt || !Array.isArray(snap.workflows)) {
    critical.push(`n8n稼働スナップショットの形式が不正（observedAt / workflows[] が無い）。\n      → ${N8N_REFRESH_HOWTO}`);
    return;
  }

  // ① 観測の失効: 状態が正常でも、見ていない期間が伸びれば「気づけない」状態は同じ
  const snapAge = daysAgo(snap.observedAt);
  if (snapAge >= N8N_SNAPSHOT_CRIT_DAYS) {
    critical.push(`n8nの稼働確認が ${snapAge} 日行われていない（最終確認 ${snap.observedAt}）。この間にワークフローが止まっても検知できない。\n      → ${N8N_REFRESH_HOWTO}`);
  } else if (snapAge >= N8N_SNAPSHOT_WARN_DAYS) {
    warnings.push(`n8nの稼働確認が ${snapAge} 日前（${snap.observedAt}）。そろそろ再確認すること。`);
  }

  // 戦略判断による停止と故障停止を分離する。policy.json は「警報を消す例外表」ではなく、
  // reason と解除条件を必須にした期限付きの経営判断。ファイルが壊れていれば安全側へ倒し、
  // 全ワークフローを通常の稼働対象として扱う。
  let pausedNames = new Set();
  let pauseRows = [];
  if (fs.existsSync(N8N_STATUS_POLICY_FILE)) {
    try {
      const policy = JSON.parse(fs.readFileSync(N8N_STATUS_POLICY_FILE, 'utf-8'));
      pauseRows = Array.isArray(policy.intentionallyPaused)
        ? policy.intentionallyPaused.filter((row) => row?.name && row?.reason && row?.resumeWhen)
        : [];
      pausedNames = new Set(pauseRows.map((row) => row.name));
    } catch (e) {
      warnings.push(`n8n停止ポリシーが壊れているため適用しない（${N8N_STATUS_POLICY_FILE}）: ${e.message}`);
    }
  }

  const allProd = snap.workflows.filter((w) => n8nIsProduction(w.name ?? ''));
  const intentionallyPaused = allProd.filter((w) => pausedNames.has(w.name));
  const prod = allProd.filter((w) => !pausedNames.has(w.name));
  if (intentionallyPaused.length) {
    const details = intentionallyPaused.map((w) => {
      const row = pauseRows.find((item) => item.name === w.name);
      return `${w.name}（解除=${row.resumeWhen}）`;
    });
    infos.push(`n8n: 戦略上の意図的停止 ${intentionallyPaused.length} 本: ${details.join(' / ')}`);
  }
  if (!prod.length) {
    infos.push(`n8n: 現在の稼働対象ワークフローが0本（観測 ${snapAge} 日前）`);
    return;
  }

  // ② 認証情報ゼロ = Gmail等に触る全ノードが実行時に必ず落ちる。人間のOAuth接続が唯一の解
  if (snap.credentialCount === 0) {
    critical.push(`n8nインスタンスに認証情報が0件。Gmail等に触るノードは実行時に必ず失敗する（稼働対象 ${prod.length} 本）。\n      → 【人間タスク】https://yoshikou.app.n8n.cloud を開き、左メニュー「Overview」→「Credentials」→「Add credential」で Gmail を選び、yoshikou888@gmail.com でGoogleログインを完了する。完了確認＝Credentials一覧にGmailの行が1件見えること。`);
  }

  // ③ 状態そのものの異常（active でない稼働対象）
  const inactive = prod.filter((w) => w.active !== true).map((w) => w.name);
  if (inactive.length) {
    // 停止中のものだけを名指しする。4本すべて停止していた頃の文面が asp-detect を
    // 固定で名指ししていたが、それが稼働した後も本文に残り「動いているものを止まっている」と
    // 読ませる誤誘導になっていた（2026-08-01 N8N-D01）。
    const asp = inactive.includes('asp-detect-approval-mail')
      ? '\n      → 特に asp-detect-approval-mail はASP提携承認メールの検知＝収益ファネルの主ボトルネックの監視装置。'
      : '';
    critical.push(`n8nの稼働対象 ${inactive.length}/${prod.length} 本が停止中（active:false）: ${inactive.join(' / ')}\n      → 作られただけで一度も価値を出していない。${asp}\n      → 【人間タスク】各ワークフローを開き、右上のトグルを Active（緑）にする。完了確認＝一覧の Status 列が Active になること。認証接続が先。`);
  }

  // ④ active を名乗っていても、動いた証拠が無ければ実際には動いていない。
  //    ただし「実行0」の意味はトリガー種別で正反対（2026-08-01 N8N-D01で分離）:
  //      schedule … 発火すれば必ず execution が残る → 沈黙そのものが証拠。期待間隔×1.5で判定
  //      event    … 該当データが来た時だけ execution が残る（gmailTrigger/webhook）
  //                 → 実行0は正常でありうる。ASP提携0件の間 asp-detect の実行履歴は永久に0のまま
  //    種別は n8n の実データ（トリガーノードの型と rule）から観測ごとに導出してスナップショットに載せる。
  //    ここで名前ベースの台帳を持たないのは、台帳が静かにドリフトすると「緩い方向」に壊れる＝
  //    鳴るはずのアラームが鳴らなくなるため。導出できなければ 'unknown' として厳しい既定へ倒す。
  const silent = [], waiting = [], running = [];
  for (const w of prod.filter((w) => w.active === true)) {
    if ((w.triggerKind ?? 'unknown') === 'event') {
      // イベント駆動は「自動実行が無いこと」を異常と呼べない。代わりに、一度でも
      // 通し実行された形跡（手動テストを含む）を生存証拠として使う。形跡ゼロ＝
      // 作っただけで一度も通していない状態で、これは⚠️（失敗を証明できないので🚨にしない）。
      if (w.lastExecutionAt) { waiting.push(w.name); continue; }
      warnings.push(`n8n \`${w.name}\` は active だが、実行された形跡が1件もない（手動テストすら無い）。イベント駆動（Gmail/Webhook）なので自動実行0そのものは正常だが、ワークフローが通ること自体が未検証。\n      → n8nで開き「Execute workflow」を1回押して全ノードが緑になるか確認する。`);
      continue;
    }
    const known = w.expectedIntervalHours > 0;
    const graceHours = known
      ? Math.max(w.expectedIntervalHours * N8N_GRACE_FACTOR, N8N_GRACE_FLOOR_HOURS)
      : N8N_NO_RUN_CRIT_DAYS * 24;
    // 沈黙を数える起点＝最後の自動実行。まだ1度も無ければ有効化・最終編集時刻から数える
    // （週1トリガーを有効化した直後に「実行が無い」と鳴らさないため）。
    const anchor = w.lastAutoExecutionAt ?? w.updatedAt ?? null;
    if (anchor && hoursAgo(anchor) < graceHours) { running.push(w.name); continue; }
    silent.push(w.name);
    const basis = known
      ? `期待間隔 ${w.expectedIntervalHours}時間 の1.5倍（${Math.round(graceHours)}時間）を超過`
      : `トリガー種別が未記録のため既定 ${N8N_NO_RUN_CRIT_DAYS} 日で判定（スナップショットを新形式で取り直すと精度が上がる）`;
    critical.push(w.lastAutoExecutionAt
      ? `n8n \`${w.name}\` は active だが、自動実行が ${daysAgo(w.lastAutoExecutionAt)} 日間ない（最終 ${w.lastAutoExecutionAt}／${basis}）。トリガーが発火していない疑い。\n      → n8nの Executions タブで直近の失敗を確認すること。`
      : `n8n \`${w.name}\` は active だが、自動実行の履歴が1件もない（手動テスト実行だけ／${basis}）。トリガー設定が効いていない疑い。\n      → n8nの Executions タブで mode が trigger の実行が出ているか確認すること。`);
  }

  if (!inactive.length && !silent.length && snap.credentialCount !== 0) {
    const detail = [
      running.length ? `定期 ${running.length}本=発火間隔内` : null,
      waiting.length ? `イベント ${waiting.length}本=待機中（${waiting.join(' / ')}）` : null,
    ].filter(Boolean).join(' / ');
    infos.push(`n8n: 稼働対象 ${prod.length} 本すべて正常（${detail}／観測 ${snapAge} 日前）`);
  }
}

// ── 4. draft滞留（公開レビュー待ちのバックログ）─────────────────
function checkDrafts() {
  const blogDir = path.join(ROOT, 'src/content/blog');
  const stuck = [];
  for (const f of fs.readdirSync(blogDir).filter((f) => f.endsWith('.mdx'))) {
    const head = fs.readFileSync(path.join(blogDir, f), 'utf-8').slice(0, 1500);
    const fm = head.match(/^---\n([\s\S]*?)\n---/);
    if (!fm || !/^draft:\s*true/m.test(fm[1])) continue;
    const pub = fm[1].match(/^pubDate:\s*["']?(\d{4}-\d{2}-\d{2})/m);
    const age = pub ? daysAgo(pub[1]) : null;
    stuck.push({ slug: f.replace('.mdx', ''), age });
  }
  if (stuck.length) {
    const list = stuck.map((s) => `${s.slug}（${s.age ?? '?'}日）`).join(' / ');
    const old = stuck.filter((s) => (s.age ?? 0) >= 7);
    (old.length ? warnings : infos).push(`公開レビュー待ちdraft ${stuck.length}本: ${list}\n      → CMS (tsumiba.com/cms) でレビューし、公開OKなら draft を外す。`);
  } else {
    infos.push('レビュー待ちdraftなし');
  }

  // article-drafts（管理画面ルートの下書き）の滞留も見る。
  // 2026-07-04: ここを見ていなかったため fx-kouza-campaign-hikaku の滞留を見逃した
  const draftIndexPath = path.join(ROOT, 'data/article-drafts/index.json');
  if (fs.existsSync(draftIndexPath)) {
    try {
      const entries = JSON.parse(fs.readFileSync(draftIndexPath, 'utf-8')).filter((e) => e.status === 'draft');
      if (entries.length) {
        const list = entries.map((e) => `${e.slug}（${e.draftedAt ? daysAgo(e.draftedAt) : '?'}日）`).join(' / ');
        warnings.push(`article-drafts に滞留draft ${entries.length}本: ${list}\n      → /admin/drafts でレビューし publish-draft フローで公開するか破棄する。`);
      }
    } catch {
      warnings.push('data/article-drafts/index.json が読めない（JSON破損の疑い）。');
    }
  }
}

// ── 5. handoff.md の鮮度 ────────────────────────────────────────
function checkHandoff() {
  const handoffPath = path.join(AFFILIATE_ROOT, 'AI運用/handoff.md');
  if (!fs.existsSync(handoffPath)) { warnings.push('AI運用/handoff.md が見つからない。'); return; }
  const age = daysAgo(fs.statSync(handoffPath).mtime);
  if (age >= 7) warnings.push(`handoff.md が ${age} 日間更新されていない。セッション間の引き継ぎが切れている疑い。`);
  else infos.push(`handoff.md 最終更新: ${age} 日前`);
}

// ── 6. 記憶構造の腐敗（保存≠想起。2026-07-02 構造監査で発見した2パターン）──
function checkStructure() {
  const handoffPath = path.join(AFFILIATE_ROOT, 'AI運用/handoff.md');
  if (fs.existsSync(handoffPath)) {
    const kb = Math.round(fs.statSync(handoffPath).size / 1024);
    // 35KB: rotate-handoff.mjs が30KBまで戻すので、超えたら実行する合図（2026-07-25 MNT-08で50KB→35KB）
    if (kb > 35) warnings.push(`handoff.md が ${kb}KB。読めないhandoffは形骸化する → \`node AI運用/scripts/rotate-handoff.mjs\` を実行（退避・索引追記・欠損検証まで自動。7/2に236KB放置が発生した事故と同型）。`);
    else infos.push(`handoff.md サイズ: ${kb}KB`);
  }
  // learning-log.md のサイズ（2026-07-25 MNT-08 追加）
  // handoff しか見ておらず、learning-log は50KBを超えても誰も気づかない＝同型の沈黙障害が残っていた。
  // 退避は自動化しない: learning-log は非時系列＋現行運用セクション混在の宣言型のため、
  // 日付での機械的な切り出しは現行方針をアーカイブ層へ落とす（MNT-08実施記録 §3）。
  const learningLogPath = path.join(AFFILIATE_ROOT, 'AI運用/learning-log.md');
  if (fs.existsSync(learningLogPath)) {
    const kb = Math.round(fs.statSync(learningLogPath).size / 1024);
    if (kb > 30) warnings.push(`learning-log.md が ${kb}KB。30KB超 → 古い学びを AI運用/archive/learning-log-archive-*.md へ退避。⚠️自動退避しない（「想起ミス台帳」「未確定情報」など日付なしセクションは現行運用のため必ず残す）。`);
    else infos.push(`learning-log.md サイズ: ${kb}KB`);
  }
  const queuePath = path.join(AFFILIATE_ROOT, 'AI運用/Codex委譲キュー.md');
  if (fs.existsSync(queuePath)) {
    const body = fs.readFileSync(queuePath, 'utf-8').replace(/```[\s\S]*?```/g, ''); // テンプレ例文（コードフェンス内）は数えない
    const open = body.match(/^- (状態|ステータス): 未着手/gm)?.length ?? 0;
    const age = daysAgo(fs.statSync(queuePath).mtime);
    if (open > 0 && age >= 14) warnings.push(`Codex委譲キューに未着手 ${open} 件が ${age} 日放置。撤退済み戦略のタスクが混ざる前に棚卸しを（7/2に保険タスク47日放置が発生）。`);
    else infos.push(`Codex委譲キュー: 未着手 ${open} 件 / 最終更新 ${age} 日前`);
  }
}

// ── 6-2. 正本ディレクトリの日次バックアップ健全性（2026-07-22 沈黙障害の再発防止）──
// 2026-07-16〜07-21の6日間、git-backup.sh が毎晩ゲートで中断していたのに誰にも通知されず
// 1度もpushされていなかった。「安全ゲートの失敗が通知されない」＝沈黙障害。
// git-backup.sh は set -e ＋ 全出力を1ログに追記する構造なので、
// 失敗は「開始マーカーだけあって完了マーカーがない末尾ブロック」として必ず残る。
//
// 2026-07-25 MNT-X02: 対象を AI運用/ と X自動化/ の2つへ拡張。
// MNT-X01 で X自動化/ のバックアップを開始したが、doctor は aiops-backup.log しか見ておらず
// X投稿エンジンとキュー正本のバックアップが止まっても誰も気づけない同型の穴が残っていた。
// マーカー規約（=== ... backup start === / === backup done ===）は git-backup.sh との契約なので、
// 対象ごとにロジックを複製せずテーブル＋共通関数で回す（片方だけ腐るのを防ぐ）。
// 正本: AI運用/バックアップ設計_2026-07-12.md
const BACKUP_STALE_DAYS = 2;   // LaunchAgentが2日動いていなければ停止とみなす
const BACKUP_PENDING_DAYS = 3; // 未pushコミット・未追跡ファイルの滞留許容日数

// テスト注入口: <PREFIX>_BACKUP_LOG / <PREFIX>_DIR で fixture を差し込める
// （checkXPostAvailability と同じ規約）。検証: tsumiba-blog/scripts/test-backup-health.sh
const BACKUP_TARGETS = [
  {
    label: 'AI運用/',
    log: process.env.AIOPS_BACKUP_LOG || path.join(process.env.HOME || '', 'Library/Logs/aiops-backup.log'),
    dir: process.env.AIOPS_DIR || path.join(AFFILIATE_ROOT, 'AI運用'),
    agent: 'com.kudokota.aiops-backup',
    schedule: '毎日23:30',
    grep: 'aiops-backup',
    fix: 'bash "AI運用/git-backup.sh"',
    gitleaks: 'AI運用/.gitleaks.toml',
  },
  {
    label: 'X自動化/',
    log: process.env.XAUTO_BACKUP_LOG || path.join(process.env.HOME || '', 'Library/Logs/x-automation-backup.log'),
    dir: process.env.XAUTO_DIR || path.join(AFFILIATE_ROOT, 'X自動化'),
    agent: 'com.kudokota.xautomation-backup',
    schedule: '毎日23:40',
    grep: 'xautomation-backup',
    fix: 'bash "AI運用/git-backup.sh" "$HOME/Affiliate/X自動化" "$HOME/Library/Logs/x-automation-backup.log"',
    gitleaks: 'X自動化/.gitleaks.toml',
  },
];

function checkBackupTarget(t) {
  // 対象ディレクトリごと無いマシンでは検査しない（誤検知の🚨を出さない）
  if (!fs.existsSync(t.dir)) { infos.push(`${t.label} バックアップ: 対象ディレクトリ未検出（このマシンには無い）`); return; }

  // 6-2-a. 最終実行の結果（ゲート中断・途中失敗の検知）
  if (!fs.existsSync(t.log)) {
    critical.push(`${t.label} バックアップのログが存在しない（${t.log}）。LaunchAgent ${t.agent} が一度も動いていない疑い → launchctl list | grep ${t.grep} で確認。`);
  } else {
    const text = fs.readFileSync(t.log, 'utf-8');
    const startRe = /^=== (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) backup start ===$/gm;
    let last = null, m;
    while ((m = startRe.exec(text))) last = { at: m[1], from: m.index };
    if (!last) {
      critical.push(`${t.label} バックアップログに実行記録がない（${t.log}）。LaunchAgent停止 or ログ破損の疑い。`);
    } else {
      const body = text.slice(last.from);
      const done = body.includes('=== backup done ===');
      const age = daysAgo(last.at.replace(' ', 'T'));
      if (!done) {
        const reason = body.split('\n').slice(1).map((l) => l.trim()).find(Boolean) ?? '(出力なし)';
        critical.push(`${t.label} の最終バックアップが完走していない（${last.at}）: ${reason}\n      → ${t.fix} を手動実行して原因を確認。ゲート誤検知なら ${t.gitleaks} のallowlistで解消する。`);
      }
      if (age >= BACKUP_STALE_DAYS) {
        critical.push(`${t.label} のバックアップが ${age} 日間実行されていない（最終実行 ${last.at}／想定は${t.schedule}）。LaunchAgent停止の疑い → launchctl list | grep ${t.grep}。`);
      }
      if (done && age < BACKUP_STALE_DAYS) infos.push(`${t.label} バックアップ: 最終成功 ${last.at}（${age}日前）`);
    }
  }

  // 6-2-b. 実際にリモートへ届いているか（ログが正常でも push 漏れが滞留していないかを直接見る）
  if (!fs.existsSync(path.join(t.dir, '.git'))) return;
  const ahead = Number(shQuiet(t.dir, 'git rev-list --count origin/main..HEAD').trim() || 0);
  if (ahead > 0) {
    const oldest = shQuiet(t.dir, 'git log --reverse --format=%cs origin/main..HEAD').split('\n')[0];
    const age = oldest ? daysAgo(oldest) : 0;
    if (age >= BACKUP_PENDING_DAYS) warnings.push(`${t.label} に未pushコミット ${ahead} 件が ${age} 日滞留（最古 ${oldest}）。バックアップが届いていない → ${t.fix}。`);
    else infos.push(`${t.label} 未pushコミット ${ahead} 件（最古 ${oldest}）`);
  }
  const dirty = shQuiet(t.dir, 'git status --porcelain').split('\n').filter(Boolean);
  if (dirty.length) {
    // 滞留日数はファイルmtimeで測る（未commitなのでgitに日付が無い）
    const ages = dirty.map((l) => {
      const f = path.join(t.dir, l.slice(3).replace(/^"|"$/g, ''));
      try { return daysAgo(fs.statSync(f).mtime); } catch { return 0; }
    });
    const oldestAge = Math.max(...ages);
    if (oldestAge >= BACKUP_PENDING_DAYS) warnings.push(`${t.label} に未commitの変更 ${dirty.length} 件が最大 ${oldestAge} 日滞留。日次バックアップが拾えていない → ${t.fix}。`);
    else infos.push(`${t.label} 未commitの変更 ${dirty.length} 件（最大 ${oldestAge} 日）`);
  }
}

function checkBackupHealth() {
  for (const t of BACKUP_TARGETS) checkBackupTarget(t);
}

// ── 6-3. ルート正本がバックアップ経路に乗っているか（MNT-10/11・2026-07-25）──
// Affiliate/ 自体はGitリポジトリではない（管理下は AI運用/ tsumiba-blog/ X自動化/ の3つだけ）。
// ルート直下の CLAUDE.md・AGENTS.md は**どのリポジトリにも属さず**、2026-07-25まで全損したら
// 復元不能だった（MNT-09でCLAUDE.mdを編集した際に発覚）。CLAUDE.mdは3層記憶構造の常駐層＝
// 失うと全AIセッションの判断基準・行動ルール12条・参照先マップが同時に消える。
// git-backup.sh が実体を AI運用/正本ミラー/ へ複製する構成にしたので、複製が止まったことを検知する。
// symlinkはgitがリンク文字列しか保存せず中身が守られないためコピー方式（正本ミラー/README.md）。
// 未push滞留は §6-2-b が既に見ているので、ここは**中身の差分だけ**を担当する。
// 正本: AI運用/バックアップ設計_2026-07-12.md「ルート正本ミラー」／MNT-10実施記録_2026-07-25.md
const MIRROR_DRIFT_DAYS = 2;   // 編集当日の差分は正常（その晩23:30で同期）。跨いだら経路の故障
const MIRRORED_ROOT_DOCS = ['CLAUDE.md', 'AGENTS.md'];

// テスト注入口: ROOTDOCS_DIR（原本側）/ ROOTDOCS_MIRROR_DIR（ミラー側）。§6-2 と同じ <対象>_<用途> 規約。
// 原本側にも注入口が要るのは、ヒステリシス分岐（当日=ℹ️ / MIRROR_DRIFT_DAYS超=🚨）が
// 原本のmtimeで決まるため。実CLAUDE.mdのmtimeは触れないので、これが無いと🚨側を検証できない。
//
// ⚠️ ミラー側に §6-2 の AIOPS_DIR を流用しないこと（MNT-11で踏んだ実バグ）。
// AIOPS_DIR は「バックアップ対象ディレクトリ」を意味する別用途の注入口で、
// test-backup-health.sh がこれをfixtureに差し替えると §6-3 が fixture配下にミラーを探しに行き、
// 無関係な🚨を誤発火して**他のテストを巻き添えで落とす**。注入口は用途ごとに分ける。
function checkRootDocsBackup() {
  const rootDir = process.env.ROOTDOCS_DIR || AFFILIATE_ROOT;
  const mirrorDir = process.env.ROOTDOCS_MIRROR_DIR || path.join(AFFILIATE_ROOT, 'AI運用', '正本ミラー');
  if (!fs.existsSync(mirrorDir)) {
    critical.push(`ルート正本のミラー ${mirrorDir} が存在しない。Affiliate/CLAUDE.md はどのGitリポジトリにも属さず、失うと全AIセッションの判断基準が同時に消える → bash "AI運用/git-backup.sh"。`);
    return;
  }
  for (const name of MIRRORED_ROOT_DOCS) {
    const src = path.join(rootDir, name);
    const mirror = path.join(mirrorDir, `${name}.mirror`);
    if (!fs.existsSync(src)) {
      warnings.push(`ルート正本 ${name} が見つからない（${src}）。復元: cp "${mirror}" "${src}"`);
      continue;
    }
    if (!fs.existsSync(mirror)) {
      critical.push(`${name} がバックアップ経路に乗っていない（${mirror} が無い）。ディスク障害で復元不能 → bash "AI運用/git-backup.sh"。`);
      continue;
    }
    if (fs.readFileSync(src).equals(fs.readFileSync(mirror))) {
      infos.push(`ルート正本 ${name}: ミラー同期済み`);
      continue;
    }
    const age = daysAgo(fs.statSync(src).mtime);
    if (age >= MIRROR_DRIFT_DAYS) {
      critical.push(`${name} とミラーの中身が ${age} 日ズレたまま（最終編集から日次バックアップを少なくとも1回跨いでいる）。同期が壊れており、守られているのは古い版 → bash "AI運用/git-backup.sh" で原因を確認。`);
    } else {
      infos.push(`ルート正本 ${name}: 本日の編集が未同期（今夜23:30のバックアップで同期される）`);
    }
  }
}

// ── 7. CV動線の退行（2026-07-05 直CV転換。正本: AI運用/戦略/CV動線構造_2026-07-05.md）──
async function checkCvFunnel() {
  // 7-1. リテラル分岐の腐敗検知（sticky死亡・旧優先順位FXTF残存はこのパターンで2度腐った実績）
  const blogPost = path.join(ROOT, 'src/layouts/BlogPost.astro');
  if (fs.existsSync(blogPost)) {
    const src = fs.readFileSync(blogPost, 'utf-8');
    if (!src.includes("category === 'FX・外貨'")) critical.push("BlogPost.astro のsticky CTAカテゴリ判定が実カテゴリ値 'FX・外貨' と不一致（全記事でモバイルCTAが非表示になる退行）。");
    if (!src.includes('/go/dmm-fx/')) warnings.push('BlogPost.astro のsticky送客先が最高単価のDMM FXでない（優先順位の退行疑い）。');
  }
  // 7-2. 記事CTAとASP送客のイベント分離（同名だと1送客が二重計上される）
  const articleEventFiles = [
    blogPost,
    path.join(ROOT, 'src/components/AffiliateCTA.astro'),
    path.join(ROOT, 'src/components/FxPriorityCTA.astro'),
    path.join(ROOT, 'src/components/RankingCard.astro'),
  ];
  for (const file of articleEventFiles) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf-8');
    if (src.includes('data-google-event="affiliate_click"')) {
      critical.push(`${path.relative(ROOT, file)} の記事CTAが affiliate_click を使用（/go/側と二重計上）。article_cta_click に分離すること。`);
    }
  }
  const goPage = path.join(ROOT, 'src/pages/go/[slug].astro');
  if (fs.existsSync(goPage)) {
    const src = fs.readFileSync(goPage, 'utf-8');
    if (!src.includes("gtag('event', 'go_page_view'")) critical.push('/go/到達イベント go_page_view がない。');
    if (!src.includes("gtag('event', 'affiliate_click'")) critical.push('ASP送客イベント affiliate_click がない。');
  }
  const lineRefPage = path.join(ROOT, 'src/pages/line/[ref].astro');
  if (fs.existsSync(lineRefPage)) {
    const src = fs.readFileSync(lineRefPage, 'utf-8');
    if (/確認中. DMM|リンク確認後に再開/.test(src)) warnings.push('/line/[ref].astro にDMM迂回の旧戦略文言が復活している（2026-07-05に除去済みのはず）。');
  }
  // 7-3. 本番計測タグの無言退行（Pages環境変数が消えるとフォールバックのAW-タグに戻り、GA4計測が静かに消える）
  if (!noNet) {
    try {
      const res = await fetch('https://tsumiba.com/', { signal: AbortSignal.timeout(8000) });
      const html = await res.text();
      const m = html.match(/gtag\/js\?id=([A-Za-z0-9-]+)/);
      if (!m) warnings.push('本番トップにgtagタグが見つからない（計測消失の疑い）。');
      else if (!m[1].startsWith('G-')) warnings.push(`本番の計測タグが ${m[1]}（GA4のG-でない）。Pages環境変数 PUBLIC_GOOGLE_TAG_ID の消失疑い（正: G-TXDSQQQ77M）。`);
      else infos.push(`本番計測タグ: ${m[1]}（GA4稼働）`);
    } catch { warnings.push('本番サイトの計測タグ確認に失敗（ネットワーク不通 or サイトダウン）。'); }
  }
}

// ── 8. 旧戦略の残存汚染スキャン（2026-07-05 recall-audit構造改修）────
// 戦略転換の波及チェックを「毎回横断grepすること」という善意ルールに任せると毎回1箇所ずつ漏れる
// （想起ミス台帳①④＋7/5監査で7箇所発見が実証）。検査語は名前ではなくナラティブの固有要素で引く
// —— 名前だけ「編集部」に置換され中身（借金200万→資産500万）が残った実例があるため。
// 戦略転換時は RESIDUE_PATTERNS に旧戦略の固有語を追加する（それが転換完了条件の一部）。
function checkStrategyResidue() {
  const HOME = process.env.HOME || '';
  const SELF = fileURLToPath(import.meta.url);
  const RESIDUE_PATTERNS = [
    /田中蓮|tanaka_ren/, // 旧ペルソナ名・旧XアカウントID（2026-05-31全廃）
    /借金200万|32歳・IT会社員|副業月20万|資産500万.{0,12}築/, // 旧ペルソナのナラティブ固有要素
  ];
  const NOTE_RE = /廃止|禁止|全廃|撤退|除去済み|使わない|語らない|⛔|残存/; // 廃止注記の行は汚染ではない
  const EXT_RE = /\.(md|mdx|mjs|js|py|ts|astro|yml|yaml|json|txt)$/;
  // learning-log/handoff は追記型の履歴（アーカイブ層）なので対象外
  const targets = [
    { p: path.join(AFFILIATE_ROOT, 'CLAUDE.md'), level: 'critical' },
    { p: path.join(HOME, '.claude/CLAUDE.md'), level: 'critical' },
    { p: path.join(HOME, '.claude/skills'), level: 'critical' },
    { p: path.join(HOME, '.claude/agents'), level: 'critical' },
    { p: path.join(ROOT, 'scripts'), level: 'critical' },
    { p: path.join(ROOT, 'x-automation'), level: 'critical', skip: /\/data\// },
    { p: path.join(ROOT, 'src/content/blog'), level: 'critical' },
    // 衛生実施記録(MNT-*)・受入検品・旧投稿棚卸し・正本一本化判断は監査/実査の履歴で、
    // 旧表現の引用が記録の本質（削除対象の特定・除去確認の証跡）。全件判定= AI運用/MNT-旧戦略掃除_2026-07.md
    { p: path.join(AFFILIATE_ROOT, 'AI運用'), level: 'warning', skip: /archive|learning-log|handoff|衛生実施記録|受入検品|旧投稿棚卸し|正本一本化判断/ },
    { p: path.join(AFFILIATE_ROOT, '専門記事'), level: 'warning' },
    { p: path.join(AFFILIATE_ROOT, 'ブログ運営観点'), level: 'warning' },
  ];
  const hits = [];
  for (const t of targets) {
    if (!fs.existsSync(t.p)) continue;
    const files = fs.statSync(t.p).isDirectory()
      ? fs.readdirSync(t.p, { recursive: true }).map((f) => path.join(t.p, String(f)))
      : [t.p];
    for (const f of files) {
      if (!EXT_RE.test(f) || f === SELF || (t.skip && t.skip.test(f))) continue;
      let text;
      try { text = fs.readFileSync(f, 'utf-8'); } catch { continue; }
      text.split('\n').forEach((line, i) => {
        if (NOTE_RE.test(line)) return;
        if (RESIDUE_PATTERNS.some((re) => re.test(line))) hits.push({ f, line: i + 1, level: t.level });
      });
    }
  }
  // X投稿キューは pending（これから投稿される行）だけ検査。posted/suspended は履歴なので無視。
  // 2026-07-25 X-AVAIL-01: ここは repo側 x-automation/data/ を見ていたが、そちらは2026-07-16で
  // 更新が止まった凍結コピーで、実投稿が読むのは X自動化/data/ の方（XQ-02で正本を分離）。
  // 投稿されないキューを検査していた＝この検査自体が沈黙障害だったため、正本へ向け直す。
  const queueCsv = X_QUEUE_CSV;
  if (fs.existsSync(queueCsv)) {
    const bad = readTweetQueue(queueCsv)
      .filter((r) => r.status === 'pending' && RESIDUE_PATTERNS.some((re) => re.test(r.text ?? '')));
    if (bad.length) critical.push(`tweet_queue.csv のpending投稿 ${bad.length} 件に旧戦略の残存表現。投稿される前にsuspend化すること。`);
  }
  const fmt = (list) => list.slice(0, 5).map((h) => `${path.relative(AFFILIATE_ROOT, h.f)}:${h.line}`).join(' / ') + (list.length > 5 ? ` 他${list.length - 5}箇所` : '');
  const crit = hits.filter((h) => h.level === 'critical');
  const warn = hits.filter((h) => h.level === 'warning');
  if (crit.length) critical.push(`旧戦略の残存表現が常駐層/自動生成系/公開面に ${crit.length} 箇所: ${fmt(crit)}`);
  if (warn.length) warnings.push(`旧戦略の残存表現が知識ベース/ドキュメントに ${warn.length} 箇所: ${fmt(warn)}`);
  if (!crit.length && !warn.length) infos.push('旧戦略残存スキャン: クリーン');
}

// ── 9. 日次アウトプット単位カウンタ（AI仕組み化ドクトリン §2「検証単位／日」）──
// 燃料投下の単位は「公開記事本数」ではなく「検証可能なアウトプット1単位／日」。
// これをモデルの自己申告ではなくgit/キューから機械算出する（コンテキスト資産化設計:
// 「モデルの善意頼みの仕組みは作らない」）。同一日は種別・件数が何件でも1カウント
// （連投で日数を買わせない）。正本: AI運用/戦略/AI仕組み化ドクトリン_2026-07-22.md §2
const CADENCE_WINDOW_DAYS = 14;
const AI_OPS_ROOT = path.join(AFFILIATE_ROOT, 'AI運用');

const toYmd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shQuiet = (cwd, cmd) => { try { return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

// git log を「日付 + そのcommitで触ったファイル」の配列に落とす（--name-only の素朴パース）
function gitTouches(cwd, since, until, pathspec, filter = 'AM') {
  const out = shQuiet(cwd, `git log --since="${since}" --until="${until} 23:59:59" --diff-filter=${filter} --date=short --format="@@%ad %H" --name-only -- ${pathspec}`);
  const commits = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) { cur = { date: line.slice(2, 12), sha: line.slice(13).trim(), files: [] }; commits.push(cur); }
    else if (cur && line.trim()) cur.files.push(line.trim());
  }
  return commits;
}

// CSVは本文に改行・カンマ・引用符を含むので行分割では壊れる。最小限のパーサで読む。
// 窓内の各日に「どの種別のアウトプットが出たか」を集める（1日1カウントはSetで担保）
function collectOutputUnits(since, until) {
  const units = new Map();
  const mark = (date, kind) => {
    if (!date || date < since || date > until) return;
    if (!units.has(date)) units.set(date, new Set());
    units.get(date).add(kind);
  };

  // 記事: 追加/変更された .mdx のうち、そのcommit時点で draft:true でないものだけ（下書きは燃料ではない）
  for (const c of gitTouches(ROOT, since, until, 'src/content/blog')) {
    const published = c.files.filter((f) => f.endsWith('.mdx')).some((f) => {
      // ファイル名はgit由来なのでシェル経由にせず引数配列で渡す（メタ文字の解釈事故を防ぐ）
      let head = '';
      try { head = execFileSync('git', ['show', `${c.sha}:${f}`], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).slice(0, 1500); } catch { return false; }
      const fm = head.match(/^---\n([\s\S]*?)\n---/);
      return Boolean(fm) && !/^draft:\s*true/m.test(fm[1]);
    });
    if (published) mark(c.date, '記事');
  }

  // CV改善: 本番に反映されるUI/導線コードの変更
  for (const c of gitTouches(ROOT, since, until, 'src/components src/layouts src/pages', 'AMD')) mark(c.date, 'CV改善');

  // 比較データ / 実験: AI運用は別リポジトリ（自動バックアップミラー）で、commitが
  // 「7/16〜07-22の取り残しを回収」のようにバッチ化される。commit日付だけだと実作業日が
  // 潰れて偽の欠測になるため、ファイルmtimeとの和集合で判定する（どちらも決定論的）。
  for (const [dir, kind] of [['データ正本', '比較データ'], ['実験', '実験']]) {
    for (const c of gitTouches(AI_OPS_ROOT, since, until, dir, 'AMD')) mark(c.date, kind);
    const abs = path.join(AI_OPS_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!/\.(ya?ml|md)$/.test(f) || f.startsWith('_')) continue;
      mark(toYmd(fs.statSync(path.join(abs, f)).mtime), kind);
    }
  }

  // X投稿: 実投稿されたtweetのみ（status=pending のキュー投入は燃料に数えない）。
  // 実データのstatus値は 'posted'。将来 'published' に変わっても拾えるよう両方受ける。
  // 2026-08-08 X-QUEUE-01: ここは repo側 x-automation/data/ を見ていたが、そちらは投稿エンジンが
  // 読まない凍結コピーで posted_at の最新が 2026-05-20。窓が14日である限り X投稿は構造的に必ず
  // 0日となり、実投稿があっても欠測として数え続けていた（①〜③の検査は既に X_QUEUE_CSV へ
  // 寄せてあり、同じ画面の中で別ファイルを見ていた）。投稿エンジンが読む正本へ統一する。
  if (fs.existsSync(X_QUEUE_CSV)) {
    for (const r of readTweetQueue(X_QUEUE_CSV)) {
      if (!['posted', 'published'].includes(r.status)) continue;
      mark((r.posted_at ?? '').slice(0, 10), 'X投稿');
    }
  }
  return units;
}

function checkOutputCadence(asOf) {
  const until = toYmd(asOf);
  const days = Array.from({ length: CADENCE_WINDOW_DAYS }, (_, i) => toYmd(new Date(asOf.getTime() - i * 86400000))).reverse();
  const since = days[0];
  const units = collectOutputUnits(since, until);

  const covered = days.filter((d) => units.has(d)).length;
  const missing = CADENCE_WINDOW_DAYS - covered;
  // ゼロ連続の判定からは当日を外す（診断はセッション開始時＝その日の作業前に走るため、
  // 当日ゼロを数えると毎朝1日水増しされる）。検知は1日遅れるが偽🚨を出さない。
  const closed = days.slice(0, -1);
  let run = 0, maxRun = 0, tail = 0;
  for (const d of closed) {
    if (units.has(d)) run = 0; else { run++; maxRun = Math.max(maxRun, run); }
  }
  for (let i = closed.length - 1; i >= 0 && !units.has(closed[i]); i--) tail++;

  const kinds = {};
  for (const set of units.values()) for (const k of set) kinds[k] = (kinds[k] ?? 0) + 1;
  const breakdown = Object.entries(kinds).map(([k, v]) => `${k}=${v}日`).join(' / ') || '該当なし';
  infos.push(`直近${CADENCE_WINDOW_DAYS}日のアウトプット: ${covered}/${CADENCE_WINDOW_DAYS}日（欠測: ${missing}日 / 内訳: ${breakdown}）`);

  if (maxRun >= 3) {
    critical.push(`アウトプットが連続${maxRun}日ゼロ（${tail >= 3 ? `直近${tail}日を含む・${days.at(-2)}まで` : '窓内で発生'}）。燃料投下の停止＝事業が進んでいない。品質ゲート待ちなら人間判定の滞留、ネタ切れなら知識ソース層の不足と切り分けること（正本: AI運用/戦略/AI仕組み化ドクトリン_2026-07-22.md §2）。`);
  } else if (missing > 5) {
    warnings.push(`直近${CADENCE_WINDOW_DAYS}日で欠測${missing}日（合格ラインは90日で7日以内）。比較データ・一次情報確認は法務レビュー不要で毎日1単位取れる。`);
  }
}

// ── 10. 削除したページが本番から消えていない（MNT-CACHE-01・2026-07-26）────────
// 2026-07-26 ASP-V02-b: src/pages/tsumiba-sample.astro を git rm → build → push →
// デプロイ成功まで完了したのに、本番 https://tsumiba.com/tsumiba-sample/ は HTTP 200 のままだった。
// オリジンからは消えている（/tsumiba-sample/index.html は404）のに、きれいなURL側だけ
// `public, s-maxage=604800`（7日）で焼き付いた旧コピーをエッジが返し続けていた
// （age ヘッダが実時間と同期して増える＝キャッシュ済みオブジェクトの指紋）。
//
// これが沈黙障害である理由: 「消したつもり」と「実際の到達性」が最大7日ズレたまま誰も気づかない。
// 今回消えなかったのは架空の口座条件に「PR」ボタンが付いたページで、放置は景表法・ステマ規制
// ＋ASP審査のリスクに直結する。noindex 付きで sitemap にも載らなかったため、
// sitemap検査も dist の href="#" 走査も両方すり抜けた＝既存のどの検査にも引っかからなかった。
// _redirects・_headers はオリジン応答にしか効かないので、コード側では解決できない
// （＝直せないから検知して人間へ渡す。パージはCloudflareダッシュボード操作＝人間タスク）。
//
// ⚠️ わざと `?cb=<乱数>` を付けない。キャッシュ回避URLは404を返すため、
// 探している不具合そのものを隠す（本番実測で両方の応答が出たのが診断の決め手だった）。
// 正本: AI運用/ASP-V02死にリンク是正_2026-07-26.md §③欠陥3
const DELETED_URL_WINDOW_DAYS = 14;   // エッジTTLは最長7日。その倍を見張ればパージ忘れをTTL満了まで捕捉できる
const DELETED_URL_MAX_PROBES = 20;    // 一括削除commitで本番へ大量リクエストを撃たないための上限
const DELETED_URL_TIMEOUT_MS = 8000;
// テスト注入口: DELETED_URL_ORIGIN（叩き先）/ DELETED_URL_REPO（削除履歴の取得元）。
// §6-2・§6-3 と同じ <用途>_<対象> 規約で、他検査の注入口を流用しない（MNT-11で踏んだ実バグ）。
const DELETED_URL_ORIGIN = process.env.DELETED_URL_ORIGIN || 'https://tsumiba.com';
const DELETED_URL_REPO = process.env.DELETED_URL_REPO || ROOT;
const PAGE_EXTS = ['.astro', '.md', '.mdx'];

// 削除されたソースファイル → 公開URL。astro.config.mjs は build.format 未指定＝'directory' なので
// 末尾スラッシュ付きが正（実際に200を返し続けたのも /tsumiba-sample/ の形）。
// 動的ルートは1URLに定まらず、トップは「削除したのに残っている」の対象になりえないので null。
function deletedFileToUrl(file) {
  const page = file.match(/^src\/pages\/(.+)\.(?:astro|md|mdx)$/);
  if (page) {
    const p = page[1];
    if (p.includes('[') || p === 'index') return null;
    return `/${p.replace(/\/index$/, '')}/`;
  }
  const post = file.match(/^src\/content\/blog\/(.+)\.(?:md|mdx)$/);
  return post && !post[1].includes('[') ? `/blog/${post[1]}/` : null;
}

// 削除→再追加や別ファイルでの復活は「消したつもり」ではないので候補から外す。
// 判定の権威は dist/ ではなく作業ツリー: dist/ はビルド成果物で、古いまま残っていたり
// 未ビルドで存在しなかったりする。実在するページを「消えたはず」と誤判定して偽🚨を出すと
// 検査そのものが形骸化する（Phase 0 の偽🚨対策と同じ理由）。
function urlHasSource(repo, url) {
  const seg = url.slice(1, -1);
  const bases = seg.startsWith('blog/')
    ? [path.join(repo, 'src/content/blog', seg.slice(5)), path.join(repo, 'src/pages', seg)]
    : [path.join(repo, 'src/pages', seg), path.join(repo, 'src/pages', seg, 'index')];
  return bases.some((b) => PAGE_EXTS.some((e) => fs.existsSync(b + e)));
}

async function checkDeletedPageReachability() {
  // localhost は「ネット」ではない。fixture サーバ相手の回帰テストを --no-net で走らせるための例外
  // （テストを本番と GitHub API に依存させないため。それ以外は --no-net でスキップする既存の流儀どおり）。
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(DELETED_URL_ORIGIN);
  if (noNet && !isLocal) return;

  const log = shQuiet(DELETED_URL_REPO, `git log --since="${DELETED_URL_WINDOW_DAYS} days ago" --diff-filter=D --name-only --format= -- src/pages src/content/blog`);
  const urls = [...new Set(log.split('\n').map((f) => f.trim()).filter(Boolean).map(deletedFileToUrl).filter(Boolean))]
    .filter((u) => !urlHasSource(DELETED_URL_REPO, u));
  if (!urls.length) { infos.push(`削除ページの到達性: 直近${DELETED_URL_WINDOW_DAYS}日に消えた公開URLなし`); return; }

  const targets = urls.slice(0, DELETED_URL_MAX_PROBES);
  if (urls.length > targets.length) infos.push(`削除URLが ${urls.length} 件。本番へのリクエストは先頭 ${targets.length} 件のみ検査。`);

  const results = await Promise.all(targets.map(async (u) => {
    try {
      // リダイレクトは追わない（301で別ページへ逃がしてあるのは「残存」ではない）。
      const res = await fetch(`${DELETED_URL_ORIGIN}${u}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(DELETED_URL_TIMEOUT_MS) });
      if (res.status !== 200) return { u, gone: true };
      // age があるか s-maxage が付いていればエッジ由来。無ければオリジンがまだ配信している＝直す先が違う。
      const cached = res.headers.get('age') !== null || /s-maxage/.test(res.headers.get('cache-control') ?? '');
      return { u, gone: false, cached };
    } catch (e) {
      return { u, err: e.message };
    }
  }));

  const errs = results.filter((r) => r.err);
  const live = results.filter((r) => r.gone === false);
  // ネットワーク不通で doctor を落とさない・警告も増やさない（検知できなかっただけで異常ではない）
  if (errs.length) infos.push(`削除ページの到達性: ${errs.length} 件を確認できず（${errs[0].err}）。ネットワーク不通の可能性。`);
  for (const r of live) {
    critical.push(r.cached
      ? `削除したページ ${DELETED_URL_ORIGIN}${r.u} が本番で HTTP 200（エッジキャッシュに旧コピーが残存）。オリジンからは消えていてもTTL満了（最大7日）まで配信され続ける。\n      → Cloudflareダッシュボード > tsumiba.com > Caching > Configuration > Purge Everything（または該当URLのSingle File Purge）。パージ後 \`curl -sI ${DELETED_URL_ORIGIN}${r.u}\` が404になるまで完了ではない。正本: AI運用/ASP-V02死にリンク是正_2026-07-26.md §③欠陥3`
      : `削除したページ ${DELETED_URL_ORIGIN}${r.u} が本番で HTTP 200（キャッシュ由来ではない＝オリジンがまだ配信している）。デプロイ未完了か、ビルド出力に実体が残っている疑い → npm run build 後に dist${r.u}index.html が無いことを確認する。`);
  }
  if (!live.length && !errs.length) infos.push(`削除ページの到達性: 直近${DELETED_URL_WINDOW_DAYS}日の削除 ${targets.length} 件はすべて本番から消えている`);
}

// ── 11. ASP認証ブロックの継続（MNT-BROWSER01・2026-08-07）────────────
// 2026-08-06（ASP-AUTO02）と 2026-08-07（ASP-VC01）の2日連続で、ValueCommerceログインが
// 同一原因「Claude in Chrome 拡張が未接続＝1Passwordの注入先ブラウザが0台」で失敗した。
//
// 【2026-08-07 MON-C01-R で原因が変わった。復旧文言だけ差し替えた（検知ロジックは無変更）】
//   list_connected_browsers は `Browser 1`（macOS・ローカル）を返し、実ブラウザでVCログイン画面まで
//   到達できた＝**Chrome拡張の接続は回復済み**。詰まっているのは request_credentials（3回とも
//   transport_error / retryable）で、1Passwordとのハンドシェイク側。最有力候補は
//   「Chromeプロファイル20個のうち Claude拡張は20個すべて・1Password拡張は5個にしか無い」不一致。
//   ＝旧文言「Claudeにサインインしろ」に従っても状況は1ミリも動かない。原因が変わったら
//   ASP_BLOCKER_FIX を必ず追随させること（詰まりの検知は正しいまま、案内だけがドリフトする）。
// この1点で afb（FXTF提携申請）・A8（適合2件への再申請）・VC（ログイン）の3経路が同時に止まる
// ＝収益ファネル右端の単一障害点。しかも切れたことに人間もAIも事前に気づけず、
// 毎回タスクを起動してから発覚していた（2セッション分の着手コストが無駄になった）。
//
// なぜ「拡張の接続状態」を直接見に行かないか:
//   接続状態を叩く手段は MCP の list_connected_browsers だけで、これは Claude Code の
//   セッション内にしか存在しない。ops-doctor は素のNodeスクリプトなので原理的に呼べない
//   （§3-2 の n8n が踏破済みの壁と同型。実測: globalThis にMCP由来のシンボルは1つも無い）。
//   Chromeプロファイルからサインイン状態を読む案も採らない —— 拡張の内部ストレージは
//   暗号化＋非公開形式で、読めても契約が無く静かにドリフトする（読み違えたまま「正常」を
//   返す検査＝検知装置そのものの沈黙障害になる）。
//
// 代わりに観測するのは「**詰まりが続いている事実**」。状態正本 asp_revenue_funnel_*.json は
// 既に blocked_auth / blocker:asp_login を持っており、外部依存を1つも増やさずに判定できる。
// X投稿ログの最終起動時刻(§3-2)・正本ミラーの差分日数(§6-3)と同じ、痕跡で死活を判定する型。
//
// ⚠️ 起点に last_attempt_at を使わないこと（MNT-BROWSER01で最初に検討して却下した案）。
//   last_attempt_at は「AIが試して弾かれた日」で、詰まっている間むしろ毎日今日へ更新される
//   （実データ: 08-06 → 08-07）。そこからの経過日数で判定すると常に0日となり、
//   **鳴るはずのアラームが永久に鳴らない**。継続日数の起点は「詰まりが始まった日」であり、
//   台帳に blocked_since が無い以上、submit されないまま経過した区間の始まり＝authorized_at が正。
//   （将来 blocked_since 相当のフィールドが増えたら、そちらを優先すること）
// 正本（復旧手順）: AI運用/顧客適合案件_提携申請パック_MON-C01_2026-07-28.md §0-R-4
//                    ／ AI運用/戦略/affiliate-dashboard.md「### 人間」#25
// 正本（この検査を作った経緯・B案の採用理由）: AI運用/VC成果地点確認_ASP-VC01_2026-08-07.md §5-3
const ASP_AUTH_BLOCK_CRIT_DAYS = 3;   // 3日＝2セッション分の空振りが確定する境目。以降は「たまたま」ではない
// テスト注入口: ASP_FUNNEL_STATE_DIR（§6-3 と同じ <対象>_<用途> 規約。他検査の注入口を流用しない）
const ASP_FUNNEL_STATE_DIR = process.env.ASP_FUNNEL_STATE_DIR
  || path.join(AFFILIATE_ROOT, 'AI運用', 'データ正本');
const ASP_FUNNEL_STATE_PREFIX = 'asp_revenue_funnel_';

// blocker ごとの復旧手順。CLAUDE.mdの人間タスク形式（何をするか／やるとどうなるか／手順／完了確認）を
// 1〜2行へ圧縮する。場所だけの指示（「拡張を有効にする」等）は本人が動けないため書かない。
const ASP_BLOCKER_FIX = {
  asp_login: '【人間タスク】Chromeで「Claudeのサイドパネルを使っているプロファイル」を開き、アドレスバーに chrome://extensions と入れて 1Password 拡張が入っているか見る。'
    + '無ければ https://chromewebstore.google.com/detail/aeblfdkhhhdcdjpifhhbdiojplfjncoa から追加し、あればツールバーの 1Password アイコンからサインインする（＝Claude拡張と1Password拡張を同じプロファイルへ揃える作業）。'
    + 'これで afb（FXTF提携申請）・A8（適合2件の再申請）・VC（ログイン）の3経路が同時に開く。'
    + '完了確認＝chrome://extensions に「1Password」が有効で表示され、ツールバーのアイコンを押すとロック画面ではなく金庫の項目一覧が出ること。',
};
const ASP_BLOCKER_FIX_DEFAULT = '【人間タスク】この blocker を解消しないと当該ASPの申請が1件も進まない。'
  + '状態正本の application_queue と直近の実施記録（AI運用/ASP*）を照合して原因を特定すること。';

// 状態正本はファイル名に日付が入る。ハードコードすると次の版を作った日から静かに古い値を読み続けるので、
// prefix一致の中で名前が最大のもの（＝日付が新しいもの）を選ぶ（asp-funnel-report.mjs と同じ規約）。
function resolveAspFunnelState() {
  if (!fs.existsSync(ASP_FUNNEL_STATE_DIR)) return null;
  const files = fs.readdirSync(ASP_FUNNEL_STATE_DIR)
    .filter((f) => f.startsWith(ASP_FUNNEL_STATE_PREFIX) && f.endsWith('.json'))
    .sort();
  return files.length ? path.join(ASP_FUNNEL_STATE_DIR, files.at(-1)) : null;
}

// 詰まりの起点。submit まで進んでいない限り authorized_at からの全区間が「進んでいない時間」。
// 例外的に submitted_at がある（＝一度は進んだ）行では、その後の再ブロックとみなし last_attempt_at を使う。
function aspBlockAnchor(q) {
  return (q.submitted_at ? (q.last_attempt_at ?? q.authorized_at) : (q.authorized_at ?? q.last_attempt_at)) ?? null;
}

// checkAspAuthBlock のメッセージは必ず "ASP認証" で始まる契約（test-asp-auth-block.mjs がこれで行を拾う）。
function checkAspAuthBlock() {
  const stateFile = resolveAspFunnelState();
  if (!stateFile) {
    // 対象ディレクトリごと無いマシン（CI・worktree）では鳴らさない。既存検査と同じ「無い環境ではスキップ」。
    if (!fs.existsSync(ASP_FUNNEL_STATE_DIR)) { infos.push('ASP認証ブロック: 状態正本のディレクトリ未検出（このマシンには無い）'); return; }
    warnings.push(`ASP認証ブロックの検査を実行できない（${ASP_FUNNEL_STATE_DIR} に ${ASP_FUNNEL_STATE_PREFIX}*.json が無い）。収益ファネルの状態正本そのものが失われている疑い。`);
    return;
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch (e) {
    critical.push(`ASP認証ブロックの検査に失敗（状態正本が壊れている: ${path.basename(stateFile)}）: ${e.message}\n      → node AI運用/asp-link-factory/src/validate.mjs で検証し、直すまでファネル監視（n8n asp-revenue-funnel）も同時に無効。`);
    return;
  }

  const queue = Array.isArray(state.application_queue) ? state.application_queue : [];
  // offer_id → asp_id。どのASPで詰まっているかを名指しできないと、人間タスクの宛先が決まらない。
  const aspOf = new Map((state.program_catalog ?? []).map((p) => [p.offer_id, p.asp_id]));
  const blocked = queue.filter((q) => q.status === 'blocked_auth');
  if (!blocked.length) {
    infos.push(`ASP認証ブロック: なし（application_queue ${queue.length}件）`);
    return;
  }

  // 同一原因で複数件が同時に止まるのが本症状（実測2件）。1件ずつ🚨を出すと同じ文面が並んで形骸化するため、
  // (ASP × blocker) で束ね、最も古い詰まりの日数で判定する。
  const groups = new Map();
  for (const q of blocked) {
    const key = `${aspOf.get(q.offer_id) ?? '不明ASP'}::${q.blocker ?? 'blocker未記録'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  for (const [key, rows] of groups) {
    const [aspId, blocker] = key.split('::');
    const ages = rows.map((q) => { const a = aspBlockAnchor(q); return a ? daysAgo(a) : null; }).filter((d) => d !== null);
    const days = ages.length ? Math.max(...ages) : null;
    const ids = rows.map((q) => q.application_id).join(' / ');
    const lastAttempt = rows.map((q) => q.last_attempt_at).filter(Boolean).sort().at(-1) ?? '記録なし';

    if (days === null) {
      warnings.push(`ASP認証ブロック ${rows.length}件（${aspId} / ${blocker}）だが、経過日数を測る日付（authorized_at・last_attempt_at）が1件も無い。滞留を数えられない＝放置に気づけない: ${ids}`);
      continue;
    }
    if (days < ASP_AUTH_BLOCK_CRIT_DAYS) {
      infos.push(`ASP認証ブロック ${days}日目（${aspId} / ${blocker} / ${rows.length}件・最終試行 ${lastAttempt}）。${ASP_AUTH_BLOCK_CRIT_DAYS}日で🚨に上がる。`);
      continue;
    }
    critical.push(`ASP認証ブロックが ${days} 日継続（${aspId} / blocker=${blocker} / 対象 ${rows.length}件・最終試行 ${lastAttempt}）: ${ids}\n`
      + `      → 提携申請が1件も出せない＝収益ファネル右端が停止したまま。複数経路が同時に止まる単一障害点で、起動して初めて発覚する型（2026-08-06 ASP-AUTO02 / 08-07 ASP-VC01 / 08-07 MON-C01-R）。\n`
      + `      → ${ASP_BLOCKER_FIX[blocker] ?? ASP_BLOCKER_FIX_DEFAULT}\n`
      + `      正本: AI運用/顧客適合案件_提携申請パック_MON-C01_2026-07-28.md §0-R-4 ／ AI運用/戦略/affiliate-dashboard.md「### 人間」#25`);
  }
}

// ── 実行 ────────────────────────────────────────────────────────
// --cadence-as-of=YYYY-MM-DD: カウンタの起点日をずらす（判定ロジックの動作確認用）
const asOfArg = process.argv.find((a) => a.startsWith('--cadence-as-of='));
const cadenceAsOf = asOfArg ? new Date(`${asOfArg.split('=')[1]}T12:00:00`) : new Date();

console.log('🩺 ops-doctor — 事業システム健康診断\n');
checkGit();
await checkActions();
checkQueue();
checkXPostAvailability();
checkN8nHealth();
checkDrafts();
checkHandoff();
checkStructure();
checkBackupHealth();
checkRootDocsBackup();
await checkCvFunnel();
checkStrategyResidue();
checkOutputCadence(cadenceAsOf);
await checkDeletedPageReachability();
checkAspAuthBlock();

if (critical.length) {
  console.log('🚨 要対応（今日中に潰す）');
  critical.forEach((m) => console.log(`  - ${m}`));
  console.log('');
}
if (warnings.length) {
  console.log('⚠️  警告');
  warnings.forEach((m) => console.log(`  - ${m}`));
  console.log('');
}
console.log('ℹ️  状態');
infos.forEach((m) => console.log(`  - ${m}`));
console.log(`\n判定: ${critical.length ? '🚨 要対応あり' : warnings.length ? '⚠️ 警告あり' : '✅ 全システム正常'}`);
process.exit(critical.length ? 2 : warnings.length ? 1 : 0);

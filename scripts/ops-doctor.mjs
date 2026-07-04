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
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AFFILIATE_ROOT = path.join(ROOT, '..');
const REPO_API = 'https://api.github.com/repos/Lofikota/ren-blog-';
const noNet = process.argv.includes('--no-net');

const critical = [];
const warnings = [];
const infos = [];

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
const daysAgo = (date) => Math.floor((Date.now() - new Date(date).getTime()) / 86400000);

// ── 1. git状態（未push・未commit・staleロック）──────────────────
function checkGit() {
  if (!noNet) {
    try { sh('git fetch origin main --quiet'); } catch { warnings.push('git fetch に失敗（オフライン？）。ahead/behind は古い情報の可能性。'); }
  }
  const ahead = Number(sh('git rev-list --count origin/main..HEAD'));
  const behind = Number(sh('git rev-list --count HEAD..origin/main'));
  if (ahead > 0) critical.push(`未pushコミットが ${ahead} 件ある。成果物が埋もれる前に push すること（6/15・7/2 に発生した事故と同型）。`);
  if (behind > 0) warnings.push(`origin より ${behind} コミット遅れ。CMS編集の可能性 → git pull --rebase 推奨。`);

  const dirty = sh('git status --porcelain -- src/content/blog data/keyword-queue.json');
  if (dirty) warnings.push(`記事/キューに未commitの変更あり:\n${dirty.split('\n').map((l) => `      ${l}`).join('\n')}`);

  const untracked = dirty.split('\n').filter((l) => l.startsWith('??') && l.endsWith('.mdx'));
  if (untracked.length) critical.push(`未追跡の記事ファイル ${untracked.length} 件。commitされない限り存在しないのと同じ。`);

  const locks = fs.readdirSync(path.join(ROOT, '.git')).filter((f) => f.includes('.lock'));
  if (locks.length) warnings.push(`staleなgitロックが ${locks.length} 件（Coworkサンドボックス残骸の可能性）: ${locks.join(', ')}`);

  const lastOrigin = sh('git log -1 --format=%ci origin/main');
  const age = daysAgo(lastOrigin);
  if (age >= 3) critical.push(`origin/main が ${age} 日間更新されていない。日次パイプラインが沈黙している疑い。`);
  else infos.push(`origin/main 最終更新: ${age} 日前`);
}

// ── 2. GitHub Actions 実行結果（公開APIのみ・認証不要）──────────
async function checkActions() {
  if (noNet) return;
  // kpi-update.yml は手動入力専用(workflow_dispatchのみ)のため監視対象外（実行0件が正常）
  const workflows = ['daily-article.yml', 'x-post.yml', 'x-generate.yml', 'weekly-kpi.yml'];
  for (const wf of workflows) {
    try {
      const res = await fetch(`${REPO_API}/actions/workflows/${wf}/runs?per_page=5`);
      if (!res.ok) { warnings.push(`${wf}: 実行履歴を取得できない (HTTP ${res.status})`); continue; }
      const runs = (await res.json()).workflow_runs ?? [];
      if (!runs.length) { warnings.push(`${wf}: 実行履歴が0件`); continue; }
      const failures = runs.filter((r) => r.conclusion === 'failure').length;
      const latest = runs[0];
      if (latest.conclusion === 'failure' && failures >= 3) {
        critical.push(`${wf}: 直近${runs.length}回中${failures}回失敗（最新: ${latest.created_at.slice(0, 10)}）。連続失敗＝沈黙障害。ログ: ${latest.html_url}`);
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
  infos.push(`キュー: ${items.length}件（${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' / ')}）`);

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
    if (kb > 50) warnings.push(`handoff.md が ${kb}KB。50KB超は実質読めず形骸化する → 古いエントリを AI運用/archive/ へ退避（7/2に236KB放置が発生した事故と同型）。`);
    else infos.push(`handoff.md サイズ: ${kb}KB`);
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

// ── 実行 ────────────────────────────────────────────────────────
console.log('🩺 ops-doctor — 事業システム健康診断\n');
checkGit();
await checkActions();
checkQueue();
checkDrafts();
checkHandoff();
checkStructure();

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

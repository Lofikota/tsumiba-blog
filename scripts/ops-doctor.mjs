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
const REPO_API = 'https://api.github.com/repos/Lofikota/tsumiba-blog';
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
  // Phase 0 (2026-07-11): scheduleを削除して意図停止中（正本: AI運用/戦略/媒体修復実行計画_2026-07-11.md、
  // 停止コミット: 95eeb3c〜039f6ae）。発火しないため過去runの失敗履歴は監視しない（新runが来ない限り
  // 「直近5回失敗」が永久に残り、偽の🚨になるため）。Phase 0解除で自動化を再開する時はここから外すこと。
  const paused = ['daily-article.yml', 'x-generate.yml', 'weekly-kpi.yml'];
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
    { p: path.join(AFFILIATE_ROOT, 'AI運用'), level: 'warning', skip: /archive|learning-log|handoff/ },
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
  // X投稿キューは pending（これから投稿される行）だけ検査。posted/suspended は履歴なので無視
  const queueCsv = path.join(ROOT, 'x-automation/data/tweet_queue.csv');
  if (fs.existsSync(queueCsv)) {
    const bad = fs.readFileSync(queueCsv, 'utf-8').split('\n')
      .filter((l) => l.includes('pending') && RESIDUE_PATTERNS.some((re) => re.test(l)));
    if (bad.length) critical.push(`tweet_queue.csv のpending投稿 ${bad.length} 件に旧戦略の残存表現。投稿される前にsuspend化すること。`);
  }
  const fmt = (list) => list.slice(0, 5).map((h) => `${path.relative(AFFILIATE_ROOT, h.f)}:${h.line}`).join(' / ') + (list.length > 5 ? ` 他${list.length - 5}箇所` : '');
  const crit = hits.filter((h) => h.level === 'critical');
  const warn = hits.filter((h) => h.level === 'warning');
  if (crit.length) critical.push(`旧戦略の残存表現が常駐層/自動生成系/公開面に ${crit.length} 箇所: ${fmt(crit)}`);
  if (warn.length) warnings.push(`旧戦略の残存表現が知識ベース/ドキュメントに ${warn.length} 箇所: ${fmt(warn)}`);
  if (!crit.length && !warn.length) infos.push('旧戦略残存スキャン: クリーン');
}

// ── 実行 ────────────────────────────────────────────────────────
console.log('🩺 ops-doctor — 事業システム健康診断\n');
checkGit();
await checkActions();
checkQueue();
checkDrafts();
checkHandoff();
checkStructure();
await checkCvFunnel();
checkStrategyResidue();

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

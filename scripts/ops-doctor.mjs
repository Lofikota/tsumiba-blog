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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// worktree から実行すると ROOT が .claude/worktrees/<name>/ になり、AI運用・X自動化 といった
// 兄弟ディレクトリを丸ごと見失う（＝存在するのに「無い」と誤警告する）。
// git-common-dir（常に本体の .git を指す）の親をリポジトリ本体として解決する。
const MAIN_REPO = (() => {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.dirname(gitDir);
  } catch { return ROOT; }
})();
const AFFILIATE_ROOT = path.join(MAIN_REPO, '..');
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

  checkUncommitted();

  // worktreeでは .git がファイル（gitdirへのポインタ）なので readdir が落ちる。実体を解決する。
  const gitDir = path.resolve(ROOT, sh('git rev-parse --git-dir'));
  const locks = fs.readdirSync(gitDir).filter((f) => f.includes('.lock'));
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
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// X投稿の実績正本。投稿しているのは launchd `com.tsumiba.xposter`（5分毎・日1本）で、
// 結果を書き戻すのはこのCSVだけ。同名の tsumiba-blog/x-automation/data/tweet_queue.csv は
// 旧世代のコピーで posted_at が2026-05-20で止まっており、Cloudflare D1 も
// cronトリガー無し＝自走しない停止済み系統。どちらも実績としては読まない。
// --x-queue=<path>: 検証用の差し替え。稼働中のCSVはlaunchdが5分毎に読み書きするので、
// 停止検知の動作確認でこのファイルを退避・改変してはいけない。
const X_QUEUE_PATH = process.argv.find((a) => a.startsWith('--x-queue='))?.slice(10)
  ?? path.join(AFFILIATE_ROOT, 'X自動化/data/tweet_queue.csv');
let xQueueCache;
function readXQueue() {
  if (xQueueCache !== undefined) return xQueueCache;
  if (!fs.existsSync(X_QUEUE_PATH)) return (xQueueCache = null);
  const rows = parseCsv(fs.readFileSync(X_QUEUE_PATH, 'utf-8'));
  const head = rows[0] ?? [];
  const col = Object.fromEntries(['status', 'posted_at', 'scheduled_date', 'scheduled_time', 'error'].map((k) => [k, head.indexOf(k)]));
  if (col.status < 0 || col.posted_at < 0) return (xQueueCache = null);
  const at = (r, k) => (col[k] >= 0 ? (r[col[k]] ?? '') : '');
  return (xQueueCache = rows.slice(1)
    .filter((r) => r.length > col.status)
    .map((r) => ({
      status: at(r, 'status'), posted_at: at(r, 'posted_at'),
      scheduled_date: at(r, 'scheduled_date'), scheduled_time: at(r, 'scheduled_time'), error: at(r, 'error'),
    })));
}

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
  // 実績の正本は稼働中の投稿系統が書き戻すCSVのみ（readXQueue のコメント参照）。
  for (const r of readXQueue() ?? []) {
    if (['posted', 'published'].includes(r.status)) mark(r.posted_at.slice(0, 10), 'X投稿');
  }
  return units;
}

// ── X投稿パイプラインの生死 ────────────────────────────────────
// アウトプット内訳の「X投稿=0日」だけでは、投稿が無いのか実績を読めていないのか区別できない。
// 正本を読めたかを先に判定し、0 と 未計測 を混同させない。
function checkXPosting() {
  const rows = readXQueue();
  if (!rows) {
    warnings.push(`X投稿の実績を読めない（${X_QUEUE_PATH} が無い、または列が想定外）。下のアウトプット内訳のX投稿は「0日」ではなく「未計測」。`);
    return;
  }
  const posted = rows.filter((r) => ['posted', 'published'].includes(r.status) && r.posted_at);
  const last = posted.map((r) => r.posted_at).sort().at(-1);
  const pending = rows.filter((r) => r.status === 'pending');
  const today = toYmd(new Date());
  const overdue = pending.filter((r) => r.scheduled_date && r.scheduled_date < today);
  infos.push(`X投稿: posted=${posted.length} / pending=${pending.length}（うち期限切れ${overdue.length}） / 最終投稿=${last?.slice(0, 10) ?? 'なし'}`);

  const silent = last ? daysAgo(last) : null;
  if (silent === null || silent >= 3) {
    const err = rows.filter((r) => r.status === 'error' && r.error)
      .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`)).at(-1);
    const cause = err
      ? `直近エラー(${err.scheduled_date} ${err.scheduled_time}): ${err.error.slice(0, 160)}`
      : 'errorレコードも無い＝投稿を試みた形跡すらない（launchctl list | grep xposter でジョブの生死を確認）。';
    critical.push(`X投稿が${silent === null ? '一度も成功していない' : `${silent}日間ゼロ`}（最終: ${last?.slice(0, 10) ?? 'なし'}）。集客の即効チャネルが停止している。${cause}`);
  } else if (overdue.length) {
    warnings.push(`X投稿キューに期限切れpendingが${overdue.length}件（最古 ${overdue.map((r) => r.scheduled_date).sort()[0]}）。投稿枠が消化されず先送りされている。`);
  }
  if (!pending.length) warnings.push('X投稿のpendingが0件。次の投稿予定が無く、明日以降ゼロになる。');
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

// ── 実行 ────────────────────────────────────────────────────────
// --cadence-as-of=YYYY-MM-DD: カウンタの起点日をずらす（判定ロジックの動作確認用）
const asOfArg = process.argv.find((a) => a.startsWith('--cadence-as-of='));
const cadenceAsOf = asOfArg ? new Date(`${asOfArg.split('=')[1]}T12:00:00`) : new Date();

console.log('🩺 ops-doctor — 事業システム健康診断\n');
checkGit();
await checkActions();
checkQueue();
checkDrafts();
checkHandoff();
checkStructure();
await checkCvFunnel();
checkStrategyResidue();
checkXPosting();
checkOutputCadence(cadenceAsOf);

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

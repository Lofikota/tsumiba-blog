#!/usr/bin/env node
/**
 * winning-pattern.mjs — 週次の勝ちパターン検出と「次の一手」の機械生成
 *
 * 設計方針: LLMは使わない（Rule 5）。KPIスナップショットと制作データから
 * 決定論的ルールで「何が動き出したか」「来週どこに張るか」を出す。
 * 現段階（GSC≒0・X黎明期）は「勝ちパターン探し」ではなく「動意検知」が仕事。
 *
 * 入力: data/kpi-snapshots.json / data/keyword-queue.json / src/content/blog/
 * 出力: KPI管理/weekly/<weekKey>-insights.md（weekly-kpi.yml が自動commit）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const snapshots = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kpi-snapshots.json'), 'utf-8'));
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/keyword-queue.json'), 'utf-8'));
const BLOG_DIR = path.join(ROOT, 'src/content/blog');

if (!snapshots.length) { console.log('スナップショットなし。終了。'); process.exit(0); }
const cur = snapshots[snapshots.length - 1];
const prev = snapshots[snapshots.length - 2] ?? null;

const findings = [];   // 事実（検知したこと）
const moves = [];      // 次の一手（優先度順）

// ── 1. X運用の健康と伸び ────────────────────────────────────────
if (prev) {
  const tweetsDelta = (cur.tweetCount ?? 0) - (prev.tweetCount ?? 0);
  const flwDelta = (cur.xFollowers ?? 0) - (prev.xFollowers ?? 0);
  findings.push(`X: フォロワー ${cur.xFollowers}人（週${flwDelta >= 0 ? '+' : ''}${flwDelta}）/ 週間投稿 ${tweetsDelta}本`);
  if (tweetsDelta === 0) {
    moves.push({ p: 1, text: '🚨 X投稿が完全停止中。投稿ゼロの週はフォロワー増もゼロ＝集客の唯一の即効チャネルが死んでいる。x-generate.ymlのD1同期（CLOUDFLARE_API_TOKEN）復旧が最優先。' });
  } else if (tweetsDelta > 0 && flwDelta <= 0) {
    findings.push(`X: 投稿${tweetsDelta}本に対しフォロワー増0 → 現行の投稿型が刺さっていない可能性`);
    moves.push({ p: 3, text: `X: 投稿${tweetsDelta}本→増加${flwDelta}人。反応の取れた投稿型（リプライ・図解・質問型）への配分見直しを検討（X投稿はマスフック→展開の原則で）。` });
  }
}

// ── 2. SEOの動意検知（孵化前→初表示→初クリックの3段階）──────────
const imp = cur.gsc?.impressions ?? 0;
const clicks = cur.gsc?.clicks ?? 0;
const prevImp = prev?.gsc?.impressions ?? 0;
if (clicks > 0) {
  findings.push(`🎉 GSC初クリック検知: ${clicks}クリック / ${imp}表示`);
  moves.push({ p: 1, text: `勝ち筋の芽: クリックが発生したページを weekly レポートのTOPページで特定し、同テーマの「比較/手順/レビュー」3点セットで横展開する記事をキュー最優先(priority 1-3)に積む。` });
} else if (imp > 0 && prevImp === 0) {
  findings.push(`🌱 GSC初表示検知: ${imp}表示（先週0）= インデックス孵化開始`);
  moves.push({ p: 2, text: '表示回数が出始めたクエリをGSCで確認し、掲載順位11〜30位の記事をリライト（タイトル・導入・内部リンク補強）する。' });
} else if (imp === 0) {
  const zeroWeeks = [...snapshots].reverse().findIndex((s) => (s.gsc?.impressions ?? 0) > 0);
  const span = zeroWeeks === -1 ? snapshots.length : zeroWeeks;
  findings.push(`SEO: 表示回数0が${span}週継続 = 孵化前。この段階でSEO施策をいじり回すのは無意味（Google公式: 新規サイトの評価には時間がかかる）`);
  moves.push({ p: 4, text: 'SEOは記事資産の積み上げ継続のみ（毎日1本のdraft生成→レビュー→公開）。数字をいじるのはインデックス後。' });
}

// ── 3. 制作ラインの出力ペース ───────────────────────────────────
const now = Date.now();
const published7d = queue.filter((it) => it.publishedAt && (now - new Date(it.publishedAt).getTime()) < 7 * 86400000);
const pending = queue.filter((it) => it.status === 'pending');
const drafts = fs.readdirSync(BLOG_DIR).filter((f) => {
  if (!f.endsWith('.mdx')) return false;
  const head = fs.readFileSync(path.join(BLOG_DIR, f), 'utf-8').slice(0, 800);
  return /^draft:\s*true/m.test(head.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
});
findings.push(`制作: 直近7日の生成 ${published7d.length}本 / レビュー待ちdraft ${drafts.length}本 / キュー残 ${pending.length}本`);
if (published7d.length === 0) moves.push({ p: 1, text: '🚨 直近7日の記事生成が0本。daily-article.yml の実行結果を npm run doctor で確認。' });
if (drafts.length >= 3) moves.push({ p: 2, text: `公開承認が制作ペースに追いついていない（draft ${drafts.length}本滞留）。CMS(tsumiba.com/cms)で公開判定を。公開されない記事はSEO資産にならない。` });
if (pending.length <= 5) moves.push({ p: 3, text: `キュー残${pending.length}本。CV直結キーワード（稼働ASP案件の手順/比較/審査系）を優先して補充する。` });

// ── 4. CV導線の健全性（クリックが出る前から仕込む）─────────────
const cvSlugs = queue.filter((it) => /kouza-kaisetsu|dmm|fxtf|jfx|central/.test(it.slug ?? '') && it.status === 'published').length;
findings.push(`CV直結記事（稼働ASP案件系）: 公開済み ${cvSlugs}本`);

// ── 出力 ────────────────────────────────────────────────────────
moves.sort((a, b) => a.p - b.p);
const lines = [
  `# 週次インサイト: ${cur.weekKey}（自動生成）`,
  '',
  `> winning-pattern.mjs による決定論的分析。数値の正本は同フォルダの ${cur.weekKey}.md`,
  '',
  '## 検知した事実',
  ...findings.map((f) => `- ${f}`),
  '',
  '## 次の一手（優先度順・人間は判断するだけ）',
  ...moves.map((m, i) => `${i + 1}. ${m.text}`),
  '',
  '## 勝ちパターン台帳',
  clicks > 0
    ? '- クリック発生 → TOPページのテーマを記録し、横展開の結果を翌週ここに追記する'
    : '- まだ勝ちパターン確定なし（GSCクリック0）。X投稿型・記事テーマの反応が出たらここに記録する',
  '',
  `*生成: winning-pattern.mjs / ${new Date().toISOString().slice(0, 10)}*`,
  '',
];
const outPath = path.join(ROOT, 'KPI管理/weekly', `${cur.weekKey}-insights.md`);
fs.writeFileSync(outPath, lines.join('\n'));
console.log(lines.join('\n'));
console.log(`\n✅ 保存: KPI管理/weekly/${cur.weekKey}-insights.md`);

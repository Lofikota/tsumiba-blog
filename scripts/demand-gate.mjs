#!/usr/bin/env node
/**
 * 需要ゲート — 「出す意味があるか」を検査する2本目の公開前ゲート
 *
 * 安全ゲート(quality-gate.mjs)は「出してはいけないものを止める」検査。
 * 本ゲートは「出しても意味がないものを止める」検査で、安全ゲートと同格で並ぶ（安全ゲートは触らない）。
 * 仕様正本: AI運用/戦略/検索需要ゲート設計_DEMAND-G01_2026-07-26.md §5
 *
 * 設計思想(§5-4): 判定はすべて数値比較・文字列一致で行い、モデルの主観判断を入れない。
 * したがって judgment（evaluateDemandGate）は純関数にし、外部API・ファイルI/Oは呼び出し側に置く。
 *
 * 実装済み: G-1(需要の実在) / G-3(自サイト実証) / G-4(収益接続) / G-5(重複)
 * 未実装  : G-2(競争の開閉) — GoogleがSERPの自動取得を拒否するため有料手段の人間判断待ち(§5-6・⑥)。
 *           evaluateDemandGate の serp 引数が唯一の差込口で、null の間は UNAVAILABLE を返し総合判定に影響しない。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AI_OPS = path.join(ROOT, '..', 'AI運用');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const SUGGEST_CACHE = path.join(ROOT, 'data/suggest-cache.json');
const GSC_SNAPSHOT = path.join(ROOT, 'data/gsc-snapshot.json');
const AFFILIATE_YAML = path.join(AI_OPS, 'データ正本/affiliate_links_2026-07-19.yaml');
const REJECT_LOG = path.join(AI_OPS, '需要ゲート却下ログ.md');

// ── 閾値（すべて §5-3 / §5-4 の仕様値。ここ以外に数値を散らさない）─────────
export const THRESHOLDS = {
  G1_MIN_SUGGEST: 2,     // G-1: suggest_count >= 2 でPASS
  G2_CLOSED_RATIO: 0.9,  // G-2: (公式+上場企業)/10 >= 0.9 でFAIL（未実装・入口のみ）
  G3_MAX_POSITION: 30,   // G-3: 同型記事に30位以内の実績があるか
};

// FAILの重さ。BLOCK=draft据え置き / WARN=公開可・記録のみ（§5-3 総合判定）
const SEVERITY = { 'G-1': 'BLOCK', 'G-2': 'BLOCK', 'G-3': 'WARN', 'G-4': 'WARN', 'G-5': 'WARN' };

// ── KWの正規化と型判定（G-3・G-5が依存する決定論的な分類）──────────────
export function normalizeKw(kw) {
  return String(kw ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ブランド語の対応表。brokers_2026-07-12.yaml の id を採用し、記事KWの表記ゆれを別名として持つ。
// 長い別名から先に判定する（"dmm fx" を "dmm" より先に当てる）。
export const BRAND_ALIASES = {
  'jfx': ['matrix trader', 'マトリックストレーダー', 'jforex', 'jfx'],
  'fxtf': ['ゴールデンウェイ', 'fxtf'],
  'dmm-fx': ['dmm fx', 'dmmfx'],
  'gmo-click': ['gmoクリック', 'gmo クリック', 'fxネオ'],
  'matsui': ['松井証券', '松井'],
  'rakuten': ['楽天'],
  'oanda': ['oanda'],
  'sbi-fx-alpha': ['sbi fxα', 'sbi fx'],
  'central-tanshi': ['セントラル短資'],
  'forex-com': ['forex.com'],
};

export function brandOf(kw) {
  const normalized = normalizeKw(kw);
  const pairs = Object.entries(BRAND_ALIASES)
    .flatMap(([id, aliases]) => aliases.map(alias => [id, normalizeKw(alias)]))
    .sort((a, b) => b[1].length - a[1].length);
  return pairs.find(([, alias]) => normalized.includes(alias))?.[0] ?? null;
}

// KWの「型」。DEMAND-G01 §2-3が「勝ち筋は型で決まる」と実測したため、型を同型判定の軸に使う。
// 上から順に評価する（"fx 確定申告 やり方" は howto ではなく tax として扱う）。
export const KW_PATTERNS = [
  { id: 'tax', re: /確定申告|税金|住民税|損益通算|年間損益/ },
  { id: 'review', re: /評判|口コミ|レビュー/ },
  { id: 'trouble', re: /できない|落ちた|バレ|やめとけ|危険|罠|詐欺|リスク/ },
  { id: 'howto', re: /やり方|手順|使い方|始め方|開設|作り方|読み方/ },
  { id: 'spec', re: /スプレッド|スワップ|手数料|時間|証拠金|レバレッジ|指標|ノックアウト/ },
  { id: 'compare', re: /比較|おすすめ|ランキング|選び方|違い|どっち|vs/ },
];

export function patternOf(kw) {
  const normalized = normalizeKw(kw);
  return KW_PATTERNS.find(({ re }) => re.test(normalized))?.id ?? 'general';
}

// ── 判定本体（純関数・外部I/Oなし）────────────────────────────────
/**
 * @param {object} args
 * @param {{slug,targetKw,noindex,draft}} args.article    判定対象
 * @param {Array}  args.corpus            全記事（自分を含む）。G-3のpeerとG-5の重複検出に使う
 * @param {number|null} args.suggestCount Google Suggestの件数。nullなら G-1 は UNAVAILABLE
 * @param {Record<string,number>} args.gscPositions slug -> 平均掲載順位。空なら G-3 は UNAVAILABLE
 * @param {string[]} args.partneredBrands 提携済みASPのブランドid
 * @param {{closedRatio:number}|null} args.serp G-2の差込口。nullの間は UNAVAILABLE
 */
export function evaluateDemandGate({
  article,
  corpus = [],
  suggestCount = null,
  gscPositions = {},
  partneredBrands = [],
  serp = null,
}) {
  const targetKw = article.targetKw;
  const checks = [];
  const add = (id, name, status, detail) => checks.push({ id, name, status, severity: SEVERITY[id], detail });

  if (!targetKw) {
    add('G-0', 'target_kw必須', 'FAIL', 'frontmatterに target_kw がない（需要ゲートの入力が欠けている）');
    return { slug: article.slug, targetKw: null, checks, verdict: 'BLOCK' };
  }

  const brand = brandOf(targetKw);
  const pattern = patternOf(targetKw);
  const others = corpus.filter(a => a.slug !== article.slug && !a.draft);

  // G-1 需要の実在: サジェスト件数が閾値未満なら「そもそも検索されていない」
  if (suggestCount === null) {
    add('G-1', '需要の実在', 'UNAVAILABLE', 'サジェスト未取得');
  } else if (suggestCount >= THRESHOLDS.G1_MIN_SUGGEST) {
    add('G-1', '需要の実在', 'PASS', `サジェスト${suggestCount}件 >= ${THRESHOLDS.G1_MIN_SUGGEST}`);
  } else {
    add('G-1', '需要の実在', 'FAIL', `サジェスト${suggestCount}件 < ${THRESHOLDS.G1_MIN_SUGGEST}（需要が実在しない）`);
  }

  // G-2 競争の開閉: SERP取得手段が未確保のため入口だけ空けてある
  if (serp === null || typeof serp.closedRatio !== 'number') {
    add('G-2', '競争の開閉', 'UNAVAILABLE', 'SERP取得手段が未確保（有料ツール契約は人間判断待ち・DEMAND-G01 ⑥）');
  } else if (serp.closedRatio >= THRESHOLDS.G2_CLOSED_RATIO) {
    add('G-2', '競争の開閉', 'FAIL', `closed_ratio ${serp.closedRatio} >= ${THRESHOLDS.G2_CLOSED_RATIO}（公式・上場企業が占有）`);
  } else {
    add('G-2', '競争の開閉', 'PASS', `closed_ratio ${serp.closedRatio} < ${THRESHOLDS.G2_CLOSED_RATIO}`);
  }

  // G-3 自サイト実証: 同一ブランドまたは同型パターンの記事に30位以内の実績があるか。
  // 自分自身の実績も証拠に数える（自分が取れているなら型の実証として最も強い）。
  const peers = [
    { slug: article.slug, axis: '自記事' },
    ...others
      .filter(a => (brand && brandOf(a.targetKw) === brand) || patternOf(a.targetKw) === pattern)
      .map(a => ({ slug: a.slug, axis: brand && brandOf(a.targetKw) === brand ? `同ブランド:${brand}` : `同型:${pattern}` })),
  ];
  const proof = peers.find(p => typeof gscPositions[p.slug] === 'number' && gscPositions[p.slug] <= THRESHOLDS.G3_MAX_POSITION);
  if (Object.keys(gscPositions).length === 0) {
    add('G-3', '自サイト実証', 'UNAVAILABLE', 'GSCスナップショット未取得（--refresh-gsc で更新）');
  } else if (proof) {
    add('G-3', '自サイト実証', 'PASS', `${proof.slug} が${gscPositions[proof.slug].toFixed(1)}位（${proof.axis}）`);
  } else {
    add('G-3', '自サイト実証', 'FAIL', `同ブランド(${brand ?? 'なし'})・同型(${pattern})の${peers.length}記事に${THRESHOLDS.G3_MAX_POSITION}位以内の実績なし`);
  }

  // G-4 収益接続: target_kw が提携済みASP案件のブランドに対応するか（集客記事は許容＝WARN）
  if (brand && partneredBrands.includes(brand)) {
    add('G-4', '収益接続', 'PASS', `提携済み案件「${brand}」に対応`);
  } else {
    add('G-4', '収益接続', 'FAIL', `提携済み案件に対応しない（ブランド:${brand ?? 'なし'} / 提携済み:${partneredBrands.join(',') || 'なし'}）`);
  }

  // G-5 重複: 同一 target_kw の既存公開記事があれば統合を要求
  const duplicates = others.filter(a => normalizeKw(a.targetKw) === normalizeKw(targetKw) && a.targetKw);
  if (duplicates.length === 0) {
    add('G-5', '重複', 'PASS', '同一target_kwの既存公開記事なし');
  } else {
    add('G-5', '重複', 'FAIL', `同一target_kwの記事が存在: ${duplicates.map(a => a.slug).join(', ')}（統合を要求）`);
  }

  const fails = checks.filter(c => c.status === 'FAIL');
  let verdict = 'PASS';
  if (fails.some(c => c.severity === 'BLOCK')) verdict = 'BLOCK';
  else if (fails.length > 0) verdict = 'WARN';
  // noindexは検索評価を求めていない＝需要の有無を問う意味がない(§2-7)。検査結果は残しつつ総合判定だけ外す。
  if (article.noindex) verdict = 'SKIP';

  return { slug: article.slug, targetKw, brand, pattern, checks, verdict };
}

// ── I/O ────────────────────────────────────────────────────
export function loadArticles() {
  return fs.readdirSync(BLOG_DIR)
    .filter(f => f.endsWith('.mdx'))
    .map(file => {
      const raw = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
      const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      const scalar = key => fm.match(new RegExp(`^${key}:\\s*["']?(.*?)["']?\\s*$`, 'm'))?.[1];
      const secondaryRaw = fm.match(/^secondary_kw:\s*\[(.*)\]\s*$/m)?.[1] ?? '';
      return {
        slug: file.replace(/\.mdx$/, ''),
        targetKw: scalar('target_kw') ?? null,
        secondaryKw: secondaryRaw.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean),
        draft: scalar('draft') === 'true',
        noindex: scalar('noindex') === 'true',
      };
    });
}

// 提携済み=「参加中」「提携中」のプログラムだけを収益接続の対象にする。
// 受領済みリンクがあることは提携中であることを意味しない（affiliate_links YAML の handling_rules）。
export function loadPartneredBrands() {
  if (!fs.existsSync(AFFILIATE_YAML)) return [];
  const yaml = fs.readFileSync(AFFILIATE_YAML, 'utf-8');
  const programsBlock = yaml.split(/^programs:\s*$/m)[1] ?? '';
  // 行単位で走査する。ブロック全体を1つの正規表現で切り出すと最終エントリの終端指定を誤りやすく、
  // 実際に最初の実装は最後のプログラム(fxtf)を取りこぼした（JSの正規表現に \Z は無くリテラルZになる）。
  const brands = [];
  let current = null;
  for (const line of programsBlock.split('\n')) {
    const header = line.match(/^ {2}([a-z][\w-]*):\s*$/);
    if (header) { current = header[1]; continue; }
    if (current && /^\s*partnership_status:.*(参加中|提携中)/.test(line)) {
      brands.push(current);
      current = null;
    }
  }
  return brands;
}

export function loadGscPositions() {
  if (!fs.existsSync(GSC_SNAPSHOT)) return {};
  const snapshot = JSON.parse(fs.readFileSync(GSC_SNAPSHOT, 'utf-8'));
  const positions = {};
  for (const row of snapshot.rows ?? []) {
    const slug = row.page?.match(/\/blog\/([^/]+)\/?$/)?.[1];
    if (!slug) continue;
    // 同一slugが複数行あれば最良（数値が小さい）順位を採る
    if (!(slug in positions) || row.position < positions[slug]) positions[slug] = row.position;
  }
  return positions;
}

async function refreshGscSnapshot() {
  const { fetchSearchAnalytics } = await import('./gsc-api.mjs');
  const rows = await fetchSearchAnalytics(90);
  const snapshot = { fetched: new Date().toISOString(), days: 90, rows };
  fs.writeFileSync(GSC_SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  return snapshot.rows.length;
}

// Google Suggest（無料・認証不要）。件数がそのまま「需要の実在」の代理指標になる。
// ie/oe を明示しないとレスポンスがUTF-8で返らず件数以前に文字化けする。
export async function fetchSuggestions(kw) {
  const url = 'https://suggestqueries.google.com/complete/search'
    + `?client=firefox&hl=ja&gl=jp&ie=utf-8&oe=utf-8&q=${encodeURIComponent(kw)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (tsumiba demand-gate)' } });
  if (!res.ok) throw new Error(`Suggest API ${res.status}`);
  const [, suggestions] = JSON.parse(await res.text());
  return suggestions ?? [];
}

function readCache() {
  if (!fs.existsSync(SUGGEST_CACHE)) return {};
  return JSON.parse(fs.readFileSync(SUGGEST_CACHE, 'utf-8'));
}

async function getSuggestCount(kw, cache, refresh) {
  if (!refresh && cache[kw]) return cache[kw].count;
  const suggestions = await fetchSuggestions(kw);
  cache[kw] = { count: suggestions.length, suggestions, fetched: new Date().toISOString().slice(0, 10) };
  await new Promise(r => setTimeout(r, 200)); // 連続取得を抑える
  return cache[kw].count;
}

// ── 却下ログ（BLOCKのみ1行追記・同一slug×同一判定日は重複させない）───────
function appendRejectLog(results, today) {
  const blocked = results.filter(r => r.verdict === 'BLOCK');
  if (blocked.length === 0) return 0;
  const header = '# 需要ゲート却下ログ\n\n'
    + '> `scripts/demand-gate.mjs` がBLOCK判定した記事の記録。仕様: `戦略/検索需要ゲート設計_DEMAND-G01_2026-07-26.md` §5-5\n'
    + '> BLOCKは公開不可ではなく **draft据え置き＋KW差し替え要求**（安全ゲートのFAILとは意味が違う）。\n'
    + '> SERPは動くため、ここに載った記事は四半期ごとに再評価する。\n\n'
    + '| 判定日 | slug | target_kw | 不合格理由 |\n|---|---|---|---|\n';
  const existing = fs.existsSync(REJECT_LOG) ? fs.readFileSync(REJECT_LOG, 'utf-8') : header;
  const lines = [];
  for (const r of blocked) {
    if (existing.includes(`| ${today} | ${r.slug} |`)) continue;
    const reason = r.checks.filter(c => c.status === 'FAIL' && c.severity === 'BLOCK')
      .map(c => `${c.id} ${c.name}: ${c.detail}`).join(' / ');
    lines.push(`| ${today} | ${r.slug} | ${r.targetKw ?? '—'} | ${reason} |`);
  }
  if (lines.length > 0) fs.writeFileSync(REJECT_LOG, `${existing.trimEnd()}\n${lines.join('\n')}\n`, 'utf-8');
  return lines.length;
}

// ── CLI ────────────────────────────────────────────────────
const ICON = { PASS: '✅', FAIL: '❌', UNAVAILABLE: '—', };
const VERDICT_ICON = { PASS: '✅ PASS', WARN: '⚠️  WARN', BLOCK: '🚫 BLOCK', SKIP: '⏭️  SKIP' };

// endsWith だと test-demand-gate.mjs からのimportでもCLIが起動してしまうため、パス境界で判定する。
if (/(^|\/)demand-gate\.mjs$/.test(process.argv[1] ?? '')) {
  const argv = process.argv.slice(2);
  const flag = name => argv.includes(name);
  const all = flag('--all');
  const target = argv.find(a => !a.startsWith('--'));

  if (!all && !target) {
    console.error('Usage: node scripts/demand-gate.mjs <slug|path/to/article.mdx> [--refresh-suggest]');
    console.error('       node scripts/demand-gate.mjs --all [--log] [--json] [--refresh-gsc] [--refresh-suggest]');
    process.exit(1);
  }

  if (flag('--refresh-gsc')) {
    const count = await refreshGscSnapshot();
    console.log(`GSCスナップショット更新: ${count}ページ`);
  }

  const corpus = loadArticles();
  const partneredBrands = loadPartneredBrands();
  const gscPositions = loadGscPositions();
  const cache = readCache();

  const targetSlug = target?.split('/').pop()?.replace(/\.mdx$/, '');
  const subjects = all
    ? corpus.filter(a => !a.draft)
    : corpus.filter(a => a.slug === targetSlug);
  if (subjects.length === 0) {
    console.error(`記事が見つからない: ${targetSlug}`);
    process.exit(1);
  }

  const results = [];
  for (const article of subjects) {
    const suggestCount = article.targetKw
      ? await getSuggestCount(article.targetKw, cache, flag('--refresh-suggest'))
      : null;
    results.push(evaluateDemandGate({ article, corpus, suggestCount, gscPositions, partneredBrands, serp: null }));
  }
  fs.writeFileSync(SUGGEST_CACHE, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');

  if (flag('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`\n${VERDICT_ICON[r.verdict]}  ${r.slug}  「${r.targetKw ?? '(target_kw未設定)'}」`);
      for (const c of r.checks) console.log(`   ${ICON[c.status] ?? '?'} ${c.id} ${c.name}: ${c.detail}`);
    }
    const tally = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
    console.log(`\n── 集計 ${results.length}件 ──`);
    for (const v of ['PASS', 'WARN', 'BLOCK', 'SKIP']) console.log(`  ${VERDICT_ICON[v]}: ${tally[v] ?? 0}`);
  }

  if (flag('--log')) {
    const appended = appendRejectLog(results, new Date().toISOString().slice(0, 10));
    console.log(`却下ログ追記: ${appended}行 → ${path.relative(process.cwd(), REJECT_LOG)}`);
  }

  // --all は棚卸し（監査）なので落とさない。単記事はゲートなのでBLOCKで落とす。
  if (!all && results[0].verdict === 'BLOCK') process.exit(1);
}

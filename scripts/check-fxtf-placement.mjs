#!/usr/bin/env node
/**
 * check-fxtf-placement.mjs — FXTF成果リンクの「1枠だけ有効」不変条件を決定論的に検査する
 *
 * 背景: FXTFのCTAは公開27記事に33箇所ある。affiliateLinks.ts の status だけで制御すると
 * 提携成立と同時に33箇所が一斉に外部送客へ復帰する（BIZ-FIX-ASP01 §3-2B）。
 * 配置IDのallowlistで1枠ずつ開けるようにしたが、その不変条件は
 * 「人が気をつける」ではなくコードで検査しないと必ず崩れる。
 *
 * 検査内容:
 *   A. src: 掲載面4記事に禁止表現（根拠不明の人気/安心/No.1・直接的誘引）が無い
 *   B. src: ノックアウトオプション記事の必須リスク3項目がCTAより前に一組で存在する
 *   C. src: allowlistの件数が想定どおり（増えたら気づく）
 *   D. dist: 外部成果CTAがちょうど1枠で、想定の記事・配置IDである
 *   E. dist: 他のFXTF CTAがすべて internal_nav
 *
 * 使い方:
 *   node scripts/check-fxtf-placement.mjs           # A〜C（distが無くても走る）
 *   node scripts/check-fxtf-placement.mjs --dist    # A〜E（npm run build の後に実行）
 *
 * 終了コード: 0=合格 / 1=不合格
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const DIST_DIR = path.join(ROOT, 'dist');
const CHECK_DIST = process.argv.includes('--dist');

/** 成果CTAを許可した唯一の配置（affiliateLinks.ts の allowlist と一致していること） */
const EXPECTED_PLACEMENT = 'fxtf-zero-spread:fee';
const EXPECTED_ARTICLE = 'fxtf-zero-spread';
const EXPECTED_ALLOWLIST_SIZE = 1;

/** BIZ-FIX-ASP01 §3-2A / FXTF-A8実装判定 が名指しした掲載面 */
const PLACEMENT_ARTICLES = [
  'fxtf-zero-spread',
  'fxtf-review',
  'fxtf-knockout-option',
  'fxtf-cfd-hajimekata',
];

/**
 * 根拠を伴わない優位性表現。広告主ガイドラインで「客観的事実と誤認されるおそれ」と
 * 判定されたもの＋A8の直接的誘引表現。
 * 「オリコン◯位（オリコン調べ）」のような出典付きの順位は対象外にするため、
 * 単語ではなく「出典が併記されていない形」を狙って書く。
 */
const BANNED_SRC = [
  { re: /多機能派に人気/, label: '根拠不明の「人気」（多機能派に人気）' },
  { re: /として人気(?![のが]あ)/, label: '根拠不明の「人気」' },
  { re: /なら安心/, label: '根拠不明の「安心」' },
  { re: /FXTF(なら|は)安心/, label: '根拠不明の「安心」' },
  { re: /おすすめ\s*No\.?\s*1/i, label: '根拠不明の「No.1」' },
  { re: /FXTFを先に確認/, label: 'A8禁止の直接的誘引表現' },
  { re: /FXTFから確認/, label: 'A8禁止の直接的誘引表現' },
  { re: /ゼロスプレッドだから取引コスト無料/, label: 'コスト誤認表現' },
];

/** 広告主ガイドラインがノックアウトオプションで必須とする3項目 */
const KO_REQUIRED = [
  { re: /価値は?0円/, label: '①ノックアウト価格到達で価値が0円・権利消滅' },
  { re: /自動的?に清算|自動清算/, label: '②取引期限があり期限までに決済しないと自動清算' },
  { re: /売値と買値には?差/, label: '③売値と買値の差・相場急変時のリスク' },
];

const failures = [];
const notes = [];

function read(file) {
  return fs.readFileSync(file, 'utf-8');
}

// ── A. 掲載面4記事の禁止表現 ────────────────────────────────
for (const slug of PLACEMENT_ARTICLES) {
  const file = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(file)) {
    failures.push(`[A] 掲載面が見つからない: ${slug}.mdx`);
    continue;
  }
  const body = read(file);
  for (const { re, label } of BANNED_SRC) {
    const hit = body.split('\n').findIndex((line) => re.test(line));
    if (hit >= 0) failures.push(`[A] ${slug}.mdx:${hit + 1} ${label}`);
  }
}
notes.push(`[A] 掲載面${PLACEMENT_ARTICLES.length}記事の禁止表現を${BANNED_SRC.length}パターンで検査`);

// ── B. ノックアウト記事の必須リスク3項目がCTAより前に一組であること ──
{
  const file = path.join(BLOG_DIR, 'fxtf-knockout-option.mdx');
  const body = read(file);
  const ctaIndex = body.indexOf('<AffiliateCTA');
  if (ctaIndex < 0) {
    failures.push('[B] fxtf-knockout-option.mdx にCTAが無い（前提が変わった可能性）');
  } else {
    const beforeCta = body.slice(0, ctaIndex);
    const missing = KO_REQUIRED.filter(({ re }) => !re.test(beforeCta));
    for (const item of missing) {
      failures.push(`[B] 必須リスク項目がCTA前に無い: ${item.label}`);
    }
    notes.push(
      `[B] ノックアウト必須リスク ${KO_REQUIRED.length - missing.length}/${KO_REQUIRED.length} 項目をCTA前に確認`
    );
  }
}

// ── C. allowlistの件数 ───────────────────────────────────────
{
  const code = read(path.join(ROOT, 'src/data/affiliateLinks.ts'));
  const block = code.match(/affiliatePlacementAllowlist[^=]*=\s*\[([^\]]*)\]/s)?.[1] ?? '';
  const entries = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (entries.length !== EXPECTED_ALLOWLIST_SIZE) {
    failures.push(
      `[C] allowlistが${entries.length}件（想定${EXPECTED_ALLOWLIST_SIZE}件）: ${entries.join(', ')}\n` +
        `      枠を増やす判断は実測EPCが正であることの確認後（BIZ-FIX-ASP01 §3-3 工程5）。` +
        `意図的に増やしたならこのスクリプトのEXPECTED_ALLOWLIST_SIZEも更新すること。`
    );
  }
  if (!entries.includes(EXPECTED_PLACEMENT)) {
    failures.push(`[C] allowlistに ${EXPECTED_PLACEMENT} が無い`);
  }
  notes.push(`[C] allowlist = [${entries.join(', ')}]`);
}

// ── D/E. ビルド出力の実数 ────────────────────────────────────
if (CHECK_DIST) {
  if (!fs.existsSync(DIST_DIR)) {
    failures.push('[D] dist/ が無い。先に npm run build を実行すること');
  } else {
    const htmlFiles = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.html')) htmlFiles.push(p);
      }
    })(DIST_DIR);

    // 記事本文のCTAだけを対象にする（/go/ の中間ページはHTML属性ではなくJSでaffiliateを送るため対象外）
    const ctaRe = /<a\b[^>]*data-google-event="article_cta_click"[^>]*>/g;
    const affiliateCtas = [];
    const fxtfInternalCtas = [];
    // category="affiliate" なのに /go/ を指していないCTA。押しても成果は発生しないのに
    // GA4上ではアフィリエイトクリックとして数えられ、5-KPIの送客率を実態より高く見せる。
    // 本タスクの触ってよい範囲外（src/pages/fx/index.astro 等）なので失敗にはせず警告として出す。
    const mislabeled = [];

    for (const file of htmlFiles) {
      const html = read(file);
      const rel = path.relative(DIST_DIR, file);
      for (const m of html.matchAll(ctaRe)) {
        const tag = m[0];
        const category = tag.match(/data-google-category="([^"]*)"/)?.[1] ?? '';
        const label = tag.match(/data-google-label="([^"]*)"/)?.[1] ?? '';
        const href = tag.match(/href="([^"]*)"/)?.[1] ?? '';
        if (category === 'affiliate') {
          if (href.startsWith('/go/')) affiliateCtas.push({ rel, label, href });
          else mislabeled.push({ rel, label, href });
        } else if (label.startsWith('fxtf')) {
          fxtfInternalCtas.push({ rel, label, href, category });
        }
      }
    }

    if (mislabeled.length > 0) {
      notes.push(
        `[F] ⚠️ category="affiliate" だが /go/ を指さないCTA ${mislabeled.length}件（計測ラベル誤り・本タスクのスコープ外）\n` +
          mislabeled.map((c) => `        - ${c.rel} label=${c.label} href=${c.href}`).join('\n')
      );
    }

    if (affiliateCtas.length !== 1) {
      failures.push(
        `[D] 外部成果CTA（/go/ 指向）が${affiliateCtas.length}枠（想定1枠）\n` +
          affiliateCtas.map((c) => `      - ${c.rel} label=${c.label} href=${c.href}`).join('\n')
      );
    } else {
      const only = affiliateCtas[0];
      if (only.label !== EXPECTED_PLACEMENT) {
        failures.push(`[D] 成果CTAのGA4ラベルが ${only.label}（想定 ${EXPECTED_PLACEMENT}）`);
      }
      if (!only.rel.includes(EXPECTED_ARTICLE)) {
        failures.push(`[D] 成果CTAの掲載記事が ${only.rel}（想定 ${EXPECTED_ARTICLE}）`);
      }
      if (only.href !== '/go/fxtf/') {
        failures.push(`[D] 成果CTAのhrefが ${only.href}（想定 /go/fxtf/）`);
      }
      notes.push(`[D] 成果CTA 1枠: ${only.rel} label=${only.label} href=${only.href}`);
    }

    const notInternal = fxtfInternalCtas.filter((c) => c.category !== 'internal_nav');
    if (notInternal.length > 0) {
      failures.push(
        `[E] internal_navでないFXTF CTAが${notInternal.length}件\n` +
          notInternal.map((c) => `      - ${c.rel} category=${c.category} label=${c.label}`).join('\n')
      );
    }
    const pages = new Set(fxtfInternalCtas.map((c) => c.rel));
    notes.push(`[E] internal_navのFXTF CTA ${fxtfInternalCtas.length}件 / ${pages.size}ページ`);
  }
}

// ── 出力 ─────────────────────────────────────────────────────
console.log('── FXTF成果リンク配置チェック ──────────────────');
for (const n of notes) console.log(`  ${n}`);
if (failures.length > 0) {
  console.log('');
  for (const f of failures) console.log(`  ❌ ${f}`);
  console.log(`\nFXTF_PLACEMENT=NG failures=${failures.length}`);
  process.exit(1);
}
console.log(`\nFXTF_PLACEMENT=OK checked_dist=${CHECK_DIST}`);

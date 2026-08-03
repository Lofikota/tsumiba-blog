#!/usr/bin/env node
/**
 * ASP承認 → keyword-queue.json 自動追加スクリプト
 *
 * asp-status-checker.mjs が GITHUB_OUTPUT に書き出した承認リストを読み取り、
 * data/keyword-queue.json の pending に対応するレビュー記事エントリを追加する。
 *
 * 使い方:
 *   node scripts/asp-approval-to-queue.mjs --approved "A8.net×松井証券FX, TCS×LightFX"
 *   node scripts/asp-approval-to-queue.mjs  # env の ASP_APPROVED_LIST を参照
 *   node scripts/asp-approval-to-queue.mjs --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'data/keyword-queue.json');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const CURRENT_SCOPE_CATEGORY = 'FX・外貨';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const approvedIndex = args.indexOf('--approved');
const approvedInline = args.find(a => a.startsWith('--approved='));
const approvedInlineValue = approvedInline?.split('=').slice(1).join('=');
const approvedNextValue = approvedIndex >= 0 ? args[approvedIndex + 1] : undefined;
const approvedInputError = (
  (approvedInline !== undefined && !approvedInlineValue?.trim())
  || (approvedIndex >= 0 && (!approvedNextValue || approvedNextValue.startsWith('--')))
);
const approvedArg = approvedInlineValue
  ?? (approvedIndex >= 0 ? approvedNextValue : undefined)
  ?? process.env.ASP_APPROVED_LIST
  ?? '';

// ── GITHUB_OUTPUT ──────────────────────────────────────
function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const safeValue = String(value).replace(/[\r\n]+/g, ' ');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${safeValue}\n`);
}

function emitOutputs({
  added = [],
  skipped = [],
  skippedScope = [],
  skippedUnknown = [],
  skippedDuplicate = [],
  skippedSite = [],
  invalid = [],
  result,
  inputError = '',
}) {
  setOutput('queue_result', result);
  setOutput('queue_dry_run', DRY_RUN);
  setOutput('queue_input_error', inputError || 'なし');
  setOutput('queue_added_count', added.length);
  setOutput('queue_added_slugs', added.map(entry => entry.slug).join(', ') || 'なし');
  setOutput('queue_skipped_count', skipped.length);
  setOutput('queue_skipped_scope_count', skippedScope.length);
  setOutput('queue_skipped_scope_items', skippedScope.join(' | ') || 'なし');
  setOutput('queue_skipped_unknown_count', skippedUnknown.length);
  setOutput('queue_skipped_unknown_items', skippedUnknown.join(' | ') || 'なし');
  setOutput('queue_skipped_duplicate_count', skippedDuplicate.length);
  setOutput('queue_skipped_duplicate_items', skippedDuplicate.join(' | ') || 'なし');
  setOutput('queue_skipped_site_count', skippedSite.length);
  setOutput('queue_skipped_site_items', skippedSite.join(' | ') || 'なし');
  setOutput('queue_invalid_count', invalid.length);
  setOutput('queue_invalid_items', invalid.join(' | ') || 'なし');
}

// ── サイト審査メール検出（プログラム承認ではないのでスキップ） ──
const SITE_APPROVAL_PATTERNS = [
  /^ren-money\.com$/i,
  /^tsumiba\.com$/i,
  /^note\.com/i,
  /^サイト登録/,
  /^site$/i,
  /審査通過/,
  /^ren-money/i,
  /^tsumiba/i,
];

function isSiteApproval(program) {
  return SITE_APPROVAL_PATTERNS.some(p => p.test(program.trim()));
}

// ── 現行scope外と明示できる案件 ──────────────────────
// 一致しない案件は「未知」として別分類し、推測でキューへ追加しない。
const OUT_OF_SCOPE_PATTERNS = [
  /海外\s*FX/i,
  /(?<![A-Za-z])CFD(?![A-Za-z])/i,
  /ノックアウト(?:・?オプション|注文)?/i,
  /FX\s*スクール|投資スクール/i,
  /自動売買|システムトレード|シストレ|(?<![A-Za-z])EA(?![A-Za-z])/i,
  /NISA|iDeCo|投資信託|つみたて|株式|株取引|株口座|証券口座/i,
  /クレジットカード|ゴールドカード|カードローン/i,
  /生命保険|損害保険|保険相談|保険見直し|FP相談/i,
  /暗号資産|仮想通貨|バイナリー/i,
];

function isOutOfScopeProgram(program) {
  return OUT_OF_SCOPE_PATTERNS.some(pattern => pattern.test(program));
}

// ── 既知プログラム → queue エントリ マッピングテーブル ──
// キーは部分マッチ（toLowerCase で比較）
const PROGRAM_MAP = [
  // ── FX ──────────────────────────────────────────────
  {
    match: ['dmm fx', 'dmm_fx', 'dmmfx'],
    entry: {
      slug: 'dmm-fx-review',
      keyword: 'DMM FX 評判 スプレッド 初心者',
      type: 'review',
      category: 'FX・外貨',
      notes: 'DMM FXのスプレッド・ツール・口座開設を編集部視点でレビュー。他社比較と初心者向け解説を含める',
    },
  },
  {
    match: ['jfx', 'matrix trader', 'matrixtrader'],
    entry: {
      slug: 'jfx-review',
      keyword: 'JFX 評判 MATRIX TRADER MT5チャート',
      type: 'review',
      category: 'FX・外貨',
      notes: 'JFXの国内FX取引条件とMATRIX TRADERを公式情報ベースで比較。MT5チャートは分析専用で発注機能が実装されていない（EAによる自動売買も不可）、注文はMATRIX TRADERから行うと明記する。MT4は2026年8月19日に提供終了しMT5へ移行するため、バージョン名に事実を紐づけない',
    },
  },
  {
    match: ['fxtf', 'ゴールデンウェイ・ジャパン', 'goldenway japan'],
    entry: {
      slug: 'fxtf-review',
      keyword: 'FXTF 評判 国内FX MT4',
      type: 'review',
      category: 'FX・外貨',
      notes: 'FXTFの国内FX取引条件・MT4・スマホツールを公式情報ベースで比較し、国内FX口座の判断材料だけを扱う',
    },
  },
  {
    match: ['lightfx', 'ライトfx', 'light fx'],
    entry: {
      slug: 'lightfx-review',
      keyword: 'LIGHT FX 評判 スワップ スプレッド',
      type: 'review',
      category: 'FX・外貨',
      notes: 'LIGHT FXの少額開始条件・スプレッド・スマホツールを公式情報ベースで比較し、初心者の判断材料を整理する',
    },
  },
  {
    match: ['みんなのfx', 'minnano fx', 'みんなのFX'],
    entry: {
      slug: 'minnano-fx-review',
      keyword: 'みんなのFX 評判 スワップ 口座開設',
      type: 'review',
      category: 'FX・外貨',
      notes: 'みんなのFXの少額開始条件・スプレッド・スマホツールを公式情報ベースで比較し、初心者の判断材料を整理する',
    },
  },
  {
    match: ['gmo外貨', 'gmo 外貨', '外貨ex'],
    entry: {
      slug: 'gmo-gaika-review',
      keyword: 'GMO外貨 評判 スプレッド ツール',
      type: 'review',
      category: 'FX・外貨',
      notes: 'GMO外貨の少額開始条件・スプレッド・スマホツールを公式情報ベースで比較し、旧サービス名「外貨ex」との関係を説明する',
    },
  },
  {
    match: ['gmoクリック証券 fxネオ', 'gmo click fxneo', 'fxネオ'],
    entry: {
      slug: 'gmo-click-fx-review',
      keyword: 'GMOクリック証券 FXネオ 評判 スプレッド',
      type: 'review',
      category: 'FX・外貨',
      notes: 'GMOクリック証券FXネオの国内FX取引条件・ツール・サポートを公式情報ベースで比較する',
    },
  },
  {
    match: ['oanda', 'オアンダ'],
    entry: {
      slug: 'oanda-fx-review',
      keyword: 'OANDA FX 評判 MT4 スプレッド',
      type: 'review',
      category: 'FX・外貨',
      notes: 'OANDA証券の少額開始条件・取引ツール・スマホ利用条件を公式情報ベースで比較する。API・EA・自動売買は扱わない',
    },
  },
  {
    match: ['sbi fxトレード', 'sbifxトレード', 'sbi fxtrade', 'sbifxtrade'],
    entry: {
      slug: 'sbi-fxtrade-review',
      keyword: 'SBI FXトレード 評判 1通貨 少額',
      type: 'review',
      category: 'FX・外貨',
      notes: 'SBI FXトレードの少額開始条件・スマホツール・取引条件を公式情報ベースで比較する。SBI証券のSBI FXαとは別サービスと明記する',
    },
  },
  {
    match: ['外為どっとコム', '外為どっと', 'gaitame'],
    entry: {
      slug: 'gaitame-fx-review',
      keyword: '外為どっとコム 評判 スプレッド 初心者',
      type: 'review',
      category: 'FX・外貨',
      notes: '外為どっとコムの少額開始条件・スプレッド・スマホツールを公式情報ベースで比較し、初心者の判断材料を整理する',
    },
  },
  {
    match: ['ヒロセ通商', 'lion fx', 'hirose', 'hirose通商'],
    entry: {
      slug: 'lion-fx-review',
      keyword: 'LION FX ヒロセ通商 評判 スワップ',
      type: 'review',
      category: 'FX・外貨',
      notes: 'ヒロセ通商LION FXの少額開始条件・スプレッド・スマホツールを公式情報ベースで比較し、初心者の判断材料を整理する',
    },
  },
  {
    match: ['セントラル短資', 'central tanshi'],
    entry: {
      slug: 'central-tanshi-fx-review',
      keyword: 'セントラル短資FX 評判 スプレッド',
      type: 'review',
      category: 'FX・外貨',
      notes: 'セントラル短資FXの少額開始条件・スプレッド・スマホツールを公式情報ベースで比較する',
    },
  },
  {
    match: ['松井証券fx', '松井fx', 'matsui fx'],
    entry: {
      slug: 'matsui-fx-review',
      keyword: '松井証券FX 評判 スプレッド 初心者',
      type: 'review',
      category: 'FX・外貨',
      notes: '松井証券FXのスプレッド・ツール・サポートを編集部視点でレビュー',
    },
  },
];

// ── プログラム名 → entry 変換 ────────────────────────
function findEntryByProgram(programName) {
  const key = programName.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const { match, entry } of PROGRAM_MAP) {
    if (match.some(m => key.includes(m.normalize('NFKC').toLowerCase()))) {
      return entry;
    }
  }
  return null;
}

// ── メイン ───────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  ASP承認 → キュー自動追加             ║');
  console.log('╚══════════════════════════════════════╝');
  if (DRY_RUN) console.log('  [DRY-RUN モード: ファイルは変更しません]');
  console.log('');

  const added = [];
  const skipped = [];
  const skippedScope = [];
  const skippedUnknown = [];
  const skippedDuplicate = [];
  const skippedSite = [];
  const invalid = [];

  if (approvedInputError) {
    const message = '--approved の値がありません。`--approved "ASP×プログラム名"` の形式で指定してください。';
    console.error(message);
    emitOutputs({ result: 'input_error', inputError: 'missing_approved_value', invalid: ['--approved'] });
    process.exitCode = 1;
    return;
  }

  if (!approvedArg || approvedArg === 'なし') {
    console.log('承認リストが空です。キューへの追加をスキップします。');
    emitOutputs({ result: 'empty' });
    return;
  }

  // "A8.net×松井証券FX, TCS×LightFX" → [{asp, program}, ...]
  const entries = approvedArg.split(',').map(s => s.trim()).filter(Boolean).flatMap(s => {
    const [asp, ...rest] = s.split('×');
    const entry = { asp: asp?.trim() ?? '', program: rest.join('×').trim() };
    if (!entry.asp || !entry.program) {
      invalid.push(s);
      return [];
    }
    return [entry];
  });

  if (invalid.length > 0) {
    console.error(`承認リストの形式が不正です: ${invalid.join(', ')}`);
    emitOutputs({
      result: 'input_error',
      inputError: 'invalid_approved_syntax',
      invalid,
      skipped,
    });
    process.exitCode = 1;
    return;
  }

  console.log(`承認プログラム数: ${entries.length}`);
  entries.forEach(e => console.log(`  - ${e.asp} × ${e.program}`));
  console.log('');

  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  const existingSlugs = new Set(queue.map(q => q.slug));
  const existingKeywords = new Set(queue.map(q => q.keyword?.toLowerCase()));
  const existingArticleSlugs = new Set(
    fs.readdirSync(BLOG_DIR)
      .filter(file => /\.mdx?$/i.test(file))
      .map(file => file.replace(/\.mdx?$/i, '')),
  );

  for (const { asp, program } of entries) {
    console.log(`\n処理中: ${asp} × ${program}`);

    // サイト審査メール判定
    if (isSiteApproval(program)) {
      console.log('  → サイト承認メールのためスキップ（プログラム承認ではない）');
      skipped.push(`${asp}×${program} (サイト承認)`);
      skippedSite.push(`${asp}×${program}`);
      continue;
    }

    // 対象外商品を含む案件は、国内FX会社名も含んでいてもallowlist照合前に拒否する
    if (isOutOfScopeProgram(program)) {
      console.log('  → skipped_scope（現行scope外）');
      skipped.push(`${asp}×${program} (skipped_scope)`);
      skippedScope.push(`${asp}×${program}`);
      continue;
    }

    // 未知案件は推定せず、対象外とは分けて安全側で拒否する
    const entry = findEntryByProgram(program);
    if (!entry || entry.category !== CURRENT_SCOPE_CATEGORY) {
      console.log('  → skipped_unknown（国内FX allowlistに未登録）');
      skipped.push(`${asp}×${program} (skipped_unknown)`);
      skippedUnknown.push(`${asp}×${program}`);
      continue;
    }
    console.log(`  → 国内FX allowlistで発見: ${entry.slug}`);

    // 公開・下書きを問わず記事ファイルがある場合、再生成キューへ戻さない
    if (existingArticleSlugs.has(entry.slug)) {
      console.log(`  → スキップ（記事が存在: ${entry.slug}）`);
      skipped.push(`${asp}×${program} (記事が存在: ${entry.slug})`);
      skippedDuplicate.push(`${asp}×${program} (article: ${entry.slug})`);
      continue;
    }

    // キュー内の重複チェック
    if (existingSlugs.has(entry.slug)) {
      console.log(`  → スキップ（slug重複: ${entry.slug}）`);
      skipped.push(`${asp}×${program} (slug重複: ${entry.slug})`);
      skippedDuplicate.push(`${asp}×${program} (slug: ${entry.slug})`);
      continue;
    }

    const kwLower = entry.keyword.toLowerCase();
    if (existingKeywords.has(kwLower)) {
      console.log(`  → スキップ（keyword重複: ${entry.keyword}）`);
      skipped.push(`${asp}×${program} (keyword重複)`);
      skippedDuplicate.push(`${asp}×${program} (keyword: ${entry.keyword})`);
      continue;
    }

    // キューに追加
    const newItem = {
      slug: entry.slug,
      keyword: entry.keyword,
      type: entry.type,
      category: entry.category,
      notes: entry.notes,
      status: 'pending',
      addedBy: 'asp-auto',
      addedFrom: `${asp}×${program}`,
      addedAt: new Date().toISOString(),
    };

    queue.push(newItem);
    existingSlugs.add(entry.slug);
    existingKeywords.add(kwLower);
    added.push(newItem);

    console.log(`  ✅ 追加: ${entry.slug}`);
  }

  // 結果サマリー
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`追加: ${added.length} / スキップ: ${skipped.length}`);
  if (added.length > 0) {
    console.log('\n追加エントリ:');
    added.forEach(e => console.log(`  + [${e.category}] ${e.slug} / "${e.keyword}"`));
  }

  // ファイル書き込み
  if (!DRY_RUN && added.length > 0) {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf-8');
    console.log(`\n💾 keyword-queue.json を更新しました（${queue.length}件）`);
  } else if (DRY_RUN) {
    console.log('\n[DRY-RUN] ファイルは変更しませんでした。');
  }

  emitOutputs({
    added,
    skipped,
    skippedScope,
    skippedUnknown,
    skippedDuplicate,
    skippedSite,
    invalid,
    result: added.length > 0 ? 'added' : 'skipped',
  });

  console.log('');
}

main().catch(e => {
  console.error('致命的エラー:', e.message);
  process.exit(1);
});

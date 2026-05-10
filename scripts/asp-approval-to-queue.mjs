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

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'data/keyword-queue.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const approvedArg = args.find(a => a.startsWith('--approved='))?.split('=').slice(1).join('=')
  ?? args[args.indexOf('--approved') + 1]
  ?? process.env.ASP_APPROVED_LIST
  ?? '';

// ── 環境変数ロード ───────────────────────────────────
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][^=]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

// ── GITHUB_OUTPUT ──────────────────────────────────────
function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`);
}

// ── サイト審査メール検出（プログラム承認ではないのでスキップ） ──
const SITE_APPROVAL_PATTERNS = [
  /^ren-money\.com$/i,
  /^note\.com/i,
  /^サイト登録/,
  /^site$/i,
  /審査通過/,
  /^ren-money/i,
];

function isSiteApproval(program) {
  return SITE_APPROVAL_PATTERNS.some(p => p.test(program.trim()));
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
      notes: 'DMM FXのスプレッド・ツール・口座開設を田中蓮視点でレビュー。他社比較と初心者向け解説を含める',
    },
  },
  {
    match: ['lightfx', 'ライトfx', 'light fx'],
    entry: {
      slug: 'lightfx-review',
      keyword: 'LightFX 評判 スワップ スプレッド',
      type: 'review',
      category: 'FX・外貨',
      notes: 'LightFXのスワップポイント・スプレッド・ツールを田中蓮視点でレビュー。高スワップ狙いのポジション戦略も触れる',
    },
  },
  {
    match: ['みんなのfx', 'minnano fx', 'みんなのFX'],
    entry: {
      slug: 'minnano-fx-review',
      keyword: 'みんなのFX 評判 スワップ 口座開設',
      type: 'review',
      category: 'FX・外貨',
      notes: 'みんなのFXのスワップポイント高さ・スプレッド・トレード環境を田中蓮視点でレビュー',
    },
  },
  {
    match: ['gmo外貨', 'gmo 外貨', '外貨ex', 'gmoクリック証券.*fx'],
    entry: {
      slug: 'gmo-gaika-review',
      keyword: 'GMO外貨 評判 スプレッド ツール',
      type: 'review',
      category: 'FX・外貨',
      notes: 'GMO外貨のスプレッド・約定力・ツールを田中蓮視点でレビュー。外貨exとの違いも解説',
    },
  },
  {
    match: ['oanda', 'オアンダ'],
    entry: {
      slug: 'oanda-fx-review',
      keyword: 'OANDA FX 評判 MT4 スプレッド',
      type: 'review',
      category: 'FX・外貨',
      notes: 'OANDA FXのMT4/MT5対応・スプレッド・約定力を田中蓮視点でレビュー。裁量トレーダー向けの評価を中心に',
    },
  },
  {
    match: ['sbi fx', 'sbiフックストレード', 'sbi fxトレード'],
    entry: {
      slug: 'sbi-fx-review',
      keyword: 'SBI FXトレード 評判 1通貨 少額',
      type: 'review',
      category: 'FX・外貨',
      notes: 'SBI FXトレードの1通貨から取引できる少額投資の特徴を田中蓮視点でレビュー。初心者練習口座としての活用法も',
    },
  },
  {
    match: ['外為どっとコム', '外為どっと', 'gaitame'],
    entry: {
      slug: 'gaitame-fx-review',
      keyword: '外為どっとコム 評判 スプレッド 初心者',
      type: 'review',
      category: 'FX・外貨',
      notes: '外為どっとコムのスプレッド・スワップ・老舗の信頼性を田中蓮視点でレビュー',
    },
  },
  {
    match: ['トレイダーズ', 'traders securities', 'みんなのシストレ'],
    entry: {
      slug: 'traders-fx-review',
      keyword: 'トレイダーズ証券 みんなのFX 評判 スワップ',
      type: 'review',
      category: 'FX・外貨',
      notes: 'トレイダーズ証券（みんなのFX/みんなのシストレ）を田中蓮視点でレビュー',
    },
  },
  {
    match: ['ヒロセ通商', 'lion fx', 'hirose', 'hirose通商'],
    entry: {
      slug: 'lion-fx-review',
      keyword: 'LION FX ヒロセ通商 評判 スワップ',
      type: 'review',
      category: 'FX・外貨',
      notes: 'ヒロセ通商LION FXのスワップポイント・スプレッド・ツールを田中蓮視点でレビュー',
    },
  },
  {
    match: ['xm', 'xm trading', 'xmtrading'],
    entry: {
      slug: 'xm-trading-review',
      keyword: 'XM Trading 評判 ボーナス 海外FX',
      type: 'review',
      category: 'FX・外貨',
      notes: 'XM Tradingの海外FX特徴・ボーナス・MT4/MT5環境を田中蓮視点でレビュー。リスク注意書きを必ず含める',
    },
  },
  {
    match: ['セントラル短資', 'central tanshi'],
    entry: {
      slug: 'central-tanshi-fx-review',
      keyword: 'セントラル短資FX 評判 スプレッド',
      type: 'review',
      category: 'FX・外貨',
      notes: 'セントラル短資FXのスプレッド・約定力を田中蓮視点でレビュー',
    },
  },
  // ── 証券 ─────────────────────────────────────────────
  {
    match: ['sbi証券', 'sbi securities', 'sbi shoken'],
    entry: {
      slug: 'sbi-shoken-review',
      keyword: 'SBI証券 評判 手数料 初心者 NISA',
      type: 'review',
      category: '証券・株式',
      notes: 'SBI証券の手数料・NISA/iDeCo対応・ツールを田中蓮視点でレビュー。楽天証券との比較も含める',
    },
  },
  {
    match: ['楽天証券', 'rakuten securities', '楽天しょうけん'],
    entry: {
      slug: 'rakuten-shoken-review',
      keyword: '楽天証券 評判 手数料 楽天ポイント NISA',
      type: 'review',
      category: '証券・株式',
      notes: '楽天証券の楽天ポイント還元・NISA・SPUとの連携を田中蓮視点でレビュー',
    },
  },
  {
    match: ['マネックス証券', 'monex', 'マネックスしょうけん'],
    entry: {
      slug: 'monex-review',
      keyword: 'マネックス証券 評判 米国株 手数料',
      type: 'review',
      category: '証券・株式',
      notes: 'マネックス証券の米国株・銘柄スクリーナー・手数料を田中蓮視点でレビュー',
    },
  },
  {
    match: ['松井証券fx', '松井fx', 'matsui fx'],
    entry: {
      slug: 'matsui-fx-review',
      keyword: '松井証券FX 評判 スプレッド 初心者',
      type: 'review',
      category: 'FX・外貨',
      notes: '松井証券FXのスプレッド・ツール・サポートを田中蓮視点でレビュー',
    },
  },
  {
    match: ['松井証券', 'matsui shoken', 'matsui securities'],
    entry: {
      slug: 'matsui-shoken-review',
      keyword: '松井証券 評判 手数料 株 初心者',
      type: 'review',
      category: '証券・株式',
      notes: '松井証券の手数料体系・ツール・ポイントサービスを田中蓮視点でレビュー',
    },
  },
  // ── クレジットカード ──────────────────────────────────
  {
    match: ['三井住友.*ゴールド.*nl', '三井住友.*goldnl', 'smbc.*gold', 'ゴールドnl'],
    entry: {
      slug: 'smbc-gold-nl-review',
      keyword: '三井住友カード ゴールドNL 評判 年会費無料 条件',
      type: 'review',
      category: 'クレジットカード',
      notes: '三井住友ゴールドNLの100万修行・年会費無料条件・ポイント還元を田中蓮実体験ベースでレビュー',
    },
  },
  {
    match: ['三井住友カード', 'smbc card', '三井住友ビザ'],
    entry: {
      slug: 'smbc-card-review',
      keyword: '三井住友カード 評判 ポイント 還元率',
      type: 'review',
      category: 'クレジットカード',
      notes: '三井住友カードの基本スペック・ポイント還元・タッチ決済を田中蓮視点でレビュー',
    },
  },
  {
    match: ['エポスカード', 'epos card', 'eposcard'],
    entry: {
      slug: 'epos-card-review',
      keyword: 'エポスカード 評判 年会費無料 ゴールド招待',
      type: 'review',
      category: 'クレジットカード',
      notes: 'エポスカードの年会費無料・ゴールド招待経路・優待を田中蓮視点でレビュー',
    },
  },
  {
    match: ['jcb.*ゴールド', 'jcb.*gold'],
    entry: {
      slug: 'jcb-gold-review',
      keyword: 'JCBゴールド 評判 ラウンジ 補償',
      type: 'review',
      category: 'クレジットカード',
      notes: 'JCBゴールドの空港ラウンジ・旅行保険・ポイント還元を田中蓮視点でレビュー',
    },
  },
  {
    match: ['jcbカード', 'jcb card', 'jcb一般'],
    entry: {
      slug: 'jcb-card-review',
      keyword: 'JCBカード W 評判 ポイント 還元率',
      type: 'review',
      category: 'クレジットカード',
      notes: 'JCBカードWの高ポイント還元・Amazon/Starbucks優遇を田中蓮視点でレビュー',
    },
  },
  {
    match: ['dカード', 'd card', 'docomo.*card', 'dカード.*ゴールド'],
    entry: {
      slug: 'd-card-review',
      keyword: 'dカード 評判 ドコモ ポイント 還元率',
      type: 'review',
      category: 'クレジットカード',
      notes: 'dカードのドコモユーザー向けポイント還元・特典を田中蓮視点でレビュー',
    },
  },
  {
    match: ['楽天カード', 'rakuten card', 'rakutencard'],
    entry: {
      slug: 'rakuten-card-review',
      keyword: '楽天カード メリット デメリット 正直',
      type: 'review',
      category: 'クレジットカード',
      notes: '楽天カードの正直レビュー。ポイント還元率・楽天経済圏との相性を田中蓮視点で評価',
    },
  },
  {
    match: ['ビックカメラsuica', 'bic suica', 'ビックカメラ.*カード'],
    entry: {
      slug: 'bic-suica-card-review',
      keyword: 'ビックカメラSuicaカード 評判 ポイント 還元率',
      type: 'review',
      category: 'クレジットカード',
      notes: 'ビックカメラSuicaカードのポイント二重取り・交通系連携を田中蓮視点でレビュー',
    },
  },
  {
    match: ['アメックス', 'amex', 'american express', 'アメリカン.*エクスプレス'],
    entry: {
      slug: 'amex-gold-review',
      keyword: 'アメックスゴールド 評判 年会費 ラウンジ',
      type: 'review',
      category: 'クレジットカード',
      notes: 'アメックスゴールドのラウンジ・旅行特典・年会費対比を田中蓮視点でレビュー',
    },
  },
  // ── 保険 ─────────────────────────────────────────────
  {
    match: ['ほけんの窓口', 'hoken no madoguchi'],
    entry: {
      slug: 'hoken-no-madoguchi-review',
      keyword: 'ほけんの窓口 評判 無料相談 押し付け',
      type: 'review',
      category: '保険',
      notes: 'ほけんの窓口の無料相談の仕組み・勧誘の実態・活用方法を田中蓮視点で解説。FX等リスク商品との比較で資産防衛の観点も',
    },
  },
  {
    match: ['保険チャンネル', 'hoken channel'],
    entry: {
      slug: 'hoken-channel-review',
      keyword: '保険チャンネル 評判 無料相談 ファイナンシャルプランナー',
      type: 'review',
      category: '保険',
      notes: '保険チャンネルのFP相談・オンライン対応・保険見直しポイントを田中蓮視点でレビュー',
    },
  },
];

// ── プログラム名 → entry 変換 ────────────────────────
function findEntryByProgram(aspName, programName) {
  const key = `${aspName} ${programName}`.toLowerCase();
  for (const { match, entry } of PROGRAM_MAP) {
    if (match.some(m => {
      try {
        return new RegExp(m, 'i').test(key);
      } catch {
        return key.includes(m.toLowerCase());
      }
    })) {
      return entry;
    }
  }
  return null;
}

// ── Claude API フォールバック ─────────────────────────
async function generateEntryWithClaude(aspName, programName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('  ⚠️  ANTHROPIC_API_KEY 未設定 — フォールバックエントリを生成');
    return makeFallbackEntry(aspName, programName);
  }

  const client = new Anthropic({ apiKey });
  const prompt = `ASPアフィリエイトプログラムが承認されました。
ASP: ${aspName}
プログラム名: ${programName}

このプログラムのレビュー記事を、副業会社員ペルソナ「田中蓮（32歳・IT会社員・借金200万→副業月20万→FIRE目指し中）」の視点でブログに書く予定です。

以下のJSONを返してください（説明文なし、JSONのみ）:
{
  "slug": "kebab-case-で30文字以内",
  "keyword": "日本語のメインキーワード 3〜5語",
  "type": "review" または "guide" または "comparison",
  "category": "FX・外貨" または "証券・株式" または "クレジットカード" または "保険" または "投資・資産運用" または "副業・節税" または "家計・節約",
  "notes": "記事の方針を100文字以内で"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0]?.text ?? '';
    const json = text.match(/\{[\s\S]+\}/)?.[0];
    if (!json) throw new Error('JSONが見つかりません');
    return JSON.parse(json);
  } catch (e) {
    console.warn(`  ⚠️  Claude API エラー: ${e.message} — フォールバックエントリを生成`);
    return makeFallbackEntry(aspName, programName);
  }
}

function makeFallbackEntry(aspName, programName) {
  const raw = `${programName}`.replace(/[^\w぀-ゟ゠-ヿ一-鿿]/g, '-').toLowerCase();
  const slug = `${raw.slice(0, 25)}-review`.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return {
    slug,
    keyword: `${programName} 評判 口コミ`,
    type: 'review',
    category: 'FX・外貨',
    notes: `${aspName} × ${programName} の承認を受けて自動生成。記事執筆前に内容・カテゴリを確認すること`,
  };
}

// ── メイン ───────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  ASP承認 → キュー自動追加             ║');
  console.log('╚══════════════════════════════════════╝');
  if (DRY_RUN) console.log('  [DRY-RUN モード: ファイルは変更しません]');
  console.log('');

  if (!approvedArg || approvedArg === 'なし') {
    console.log('承認リストが空です。キューへの追加をスキップします。');
    setOutput('queue_added_count', 0);
    return;
  }

  // "A8.net×松井証券FX, TCS×LightFX" → [{asp, program}, ...]
  const entries = approvedArg.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [asp, ...rest] = s.split('×');
    return { asp: asp?.trim() ?? '', program: rest.join('×').trim() };
  });

  console.log(`承認プログラム数: ${entries.length}`);
  entries.forEach(e => console.log(`  - ${e.asp} × ${e.program}`));
  console.log('');

  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  const existingSlugs = new Set(queue.map(q => q.slug));
  const existingKeywords = new Set(queue.map(q => q.keyword?.toLowerCase()));

  const added = [];
  const skipped = [];

  for (const { asp, program } of entries) {
    console.log(`\n処理中: ${asp} × ${program}`);

    // サイト審査メール判定
    if (isSiteApproval(program)) {
      console.log('  → サイト承認メールのためスキップ（プログラム承認ではない）');
      skipped.push(`${asp}×${program} (サイト承認)`);
      continue;
    }

    // マッピングテーブル検索
    let entry = findEntryByProgram(asp, program);

    if (entry) {
      console.log(`  → マッピングテーブルで発見: ${entry.slug}`);
    } else {
      console.log('  → テーブルにない → Claude APIで生成');
      entry = await generateEntryWithClaude(asp, program);
      console.log(`  → 生成: ${entry.slug}`);
    }

    // 重複チェック
    if (existingSlugs.has(entry.slug)) {
      console.log(`  → スキップ（slug重複: ${entry.slug}）`);
      skipped.push(`${asp}×${program} (slug重複: ${entry.slug})`);
      continue;
    }

    const kwLower = entry.keyword.toLowerCase();
    if (existingKeywords.has(kwLower)) {
      console.log(`  → スキップ（keyword重複: ${entry.keyword}）`);
      skipped.push(`${asp}×${program} (keyword重複)`);
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

  setOutput('queue_added_count', added.length);
  setOutput('queue_added_slugs', added.map(e => e.slug).join(', ') || 'なし');
  setOutput('queue_skipped_count', skipped.length);

  console.log('');
}

main().catch(e => {
  console.error('致命的エラー:', e.message);
  process.exit(1);
});

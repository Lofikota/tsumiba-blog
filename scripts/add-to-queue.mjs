#!/usr/bin/env node
/**
 * テーマ追加CLI
 * 使い方: node scripts/add-to-queue.mjs "FX 確定申告 会社員"
 *         node scripts/add-to-queue.mjs "クレカ おすすめ 主婦" --type comparison --notes "エポスカードを主軸に"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const queuePath = path.join(ROOT, 'data/keyword-queue.json');

// ───────────────────────────────
// slugの自動生成（KWから）
// ───────────────────────────────
const KW_TO_SLUG_MAP = {
  'FX': 'fx', '外貨': 'fx', '為替': 'fx',
  'NISA': 'nisa', 'ニーサ': 'nisa', '積立NISA': 'nisa',
  '証券': 'securities', '株': 'stock',
  'クレカ': 'credit-card', 'クレジット': 'credit-card',
  '節税': 'zeikin', '確定申告': 'kakuteishinkoku', '税金': 'zeikin',
  '副業': 'fukugyo', '保険': 'hoken', 'iDeCo': 'ideco',
  'ふるさと納税': 'furusato-nozei',
};

function kwToSlug(kw) {
  const base = kw
    .replace(/\s+/g, '-')
    .replace(/[^\w぀-ヿ一-鿿-]/g, '')
    .toLowerCase();

  // 英数字+ハイフンだけで構成されていればそのまま使う
  if (/^[a-z0-9-]+$/.test(base)) return base;

  // 日本語混じりの場合は既知マップで変換
  for (const [jp, en] of Object.entries(KW_TO_SLUG_MAP)) {
    if (kw.includes(jp)) {
      const suffix = kw.replace(jp, '').replace(/\s+/g, '-').replace(/[^\w]/g, '').toLowerCase().slice(0, 20);
      return suffix ? `${en}-${suffix}` : en;
    }
  }

  // フォールバック: 先頭20文字 + タイムスタンプ
  return `article-${Date.now().toString(36)}`;
}

function guessType(kw) {
  if (/比較|どっち|vs|VS|おすすめ|ランキング/.test(kw)) return 'comparison';
  if (/口コミ|評判|レビュー|体験/.test(kw)) return 'review';
  if (/やり方|方法|手順|始め方|ガイド|入門/.test(kw)) return 'guide';
  return 'guide';
}

function guessCategory(kw) {
  if (/FX|外貨|為替|スプレッド|レバレッジ/.test(kw)) return 'FX・外貨';
  if (/NISA|積立|インデックス|投資信託/.test(kw)) return '投資・資産運用';
  if (/クレカ|クレジット|ポイント|還元/.test(kw)) return 'クレジットカード';
  if (/節税|確定申告|税金|控除|iDeCo/.test(kw)) return '節税・税金';
  if (/副業|ライティング|フリーランス/.test(kw)) return '副業・収入';
  if (/保険|FP|ファイナンシャル/.test(kw)) return '保険・FP相談';
  if (/ふるさと納税|楽天|返礼品/.test(kw)) return '節税・税金';
  return '副業・収入';
}

// ───────────────────────────────
// 引数パース
// ───────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log(`
使い方:
  node scripts/add-to-queue.mjs "キーワード" [オプション]

オプション:
  --type  guide|review|comparison  (自動判定)
  --notes "追加メモ"
  --slug  カスタムスラッグ

例:
  node scripts/add-to-queue.mjs "FX 確定申告 会社員"
  node scripts/add-to-queue.mjs "エポスカード 評判" --type review
  node scripts/add-to-queue.mjs "クレカ 主婦 おすすめ" --notes "楽天カードと比較"
`);
  process.exit(0);
}

const kw = args[0];
const typeIdx = args.indexOf('--type');
const notesIdx = args.indexOf('--notes');
const slugIdx = args.indexOf('--slug');

const type = typeIdx !== -1 ? args[typeIdx + 1] : guessType(kw);
const notes = notesIdx !== -1 ? args[notesIdx + 1] : '';
const slugBase = slugIdx !== -1 ? args[slugIdx + 1] : kwToSlug(kw);

// ───────────────────────────────
// 重複チェック & slug確定
// ───────────────────────────────
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));

// slug衝突時は末尾に連番
let slug = slugBase;
let attempt = 1;
while (queue.some(q => q.slug === slug)) {
  slug = `${slugBase}-${attempt++}`;
}

// 既存記事との衝突
const blogDir = path.join(ROOT, 'src/content/blog');
if (fs.existsSync(path.join(blogDir, `${slug}.mdx`))) {
  console.error(`❌ 記事ファイルが既に存在します: src/content/blog/${slug}.mdx`);
  process.exit(1);
}

// ───────────────────────────────
// 確認プロンプト
// ───────────────────────────────
const category = guessCategory(kw);
const newItem = {
  slug,
  keyword: kw,
  type,
  category,
  notes,
  status: 'pending',
  priority: 1,
  channel: 'seo_x_organic',
  addedAt: new Date().toISOString(),
};

console.log('\n追加内容を確認してください:');
console.log('─────────────────────────────');
console.log(`  slug      : ${newItem.slug}`);
console.log(`  keyword   : ${newItem.keyword}`);
console.log(`  type      : ${newItem.type}`);
console.log(`  category  : ${newItem.category}`);
console.log(`  notes     : ${newItem.notes || '(なし)'}`);
console.log('─────────────────────────────');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('\nキューに追加しますか？ [y/N] ', (answer) => {
  rl.close();
  if (answer.toLowerCase() !== 'y') {
    console.log('キャンセルしました。');
    process.exit(0);
  }

  // pending の先頭に挿入（高優先度として）
  const pendingIdx = queue.findIndex(q => q.status === 'pending');
  if (pendingIdx === -1) {
    queue.push(newItem);
  } else {
    queue.splice(pendingIdx, 0, newItem);
  }

  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
  console.log(`\n✅ キューに追加しました: ${slug}`);
  console.log('次のステップ: node scripts/run-local.mjs で記事を今すぐ生成できます');
});

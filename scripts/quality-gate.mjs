#!/usr/bin/env node
/**
 * 自動品質チェック — 記事公開前に必ず通す
 * 戻り値: { ok: boolean, errors: string[], warnings: string[] }
 */

// 単純文字列マッチ（前後の文脈に関係なく禁止）
const BANNED_EXPRESSIONS = [
  '確実に儲かる', '絶対に損しない', '必ず増える',
  '誰でも稼げる', '絶対儲かる', 'リスクなし',
];

// 文脈考慮チェック：肯定形でのみ禁止
// 「元本保証されています」「元本保証あります」等は禁止
// 「元本保証はありません」「元本保証がない」等の否定形はOK
const BANNED_PATTERNS = [
  { pattern: /元本(が|は|を)?保証(されています|されており|されます|します|あり(?!ません|がない|はない|はしない|が))/, label: '元本保証の肯定表現' },
];


const FINANCIAL_KEYWORDS = ['FX', '投資', 'NISA', 'iDeCo', '証券', '株', '外国為替', 'レバレッジ'];

export function checkArticle(content, slug) {
  const errors = [];
  const warnings = [];

  // 文字数チェック（frontmatterとimportを除いた本文）
  const bodyOnly = content
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/^import .+$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[#*`>|]/g, '');
  const charCount = bodyOnly.trim().length;
  if (charCount < 4500) {
    errors.push(`本文が${charCount}字しかない（4,500字以上必須）`);
  }

  // PR表記チェック
  if (!content.includes('アフィリエイト広告を含みます')) {
    errors.push('「アフィリエイト広告を含みます」の表記がない');
  }

  // updatedDateチェック
  if (!content.includes('updatedDate:')) {
    errors.push('frontmatterにupdatedDateがない');
  }

  // 禁止表現チェック（単純マッチ）
  for (const expr of BANNED_EXPRESSIONS) {
    if (content.includes(expr)) {
      errors.push(`禁止表現「${expr}」が含まれている`);
    }
  }

  // 禁止パターンチェック（正規表現・文脈考慮）
  for (const { pattern, label } of BANNED_PATTERNS) {
    if (pattern.test(content)) {
      errors.push(`禁止表現「${label}」が含まれている`);
    }
  }

  // 金融記事のリスク表記チェック
  const isFinancial = FINANCIAL_KEYWORDS.some(kw => content.includes(kw));
  if (isFinancial) {
    const hasRiskDisclosure =
      content.includes('元本割れ') ||
      content.includes('リスク') ||
      content.includes('損失') ||
      content.includes('自己責任');
    if (!hasRiskDisclosure) {
      errors.push('金融記事にリスク表記がない（元本割れ/損失/自己責任のいずれかが必要）');
    }
  }

  // アフィリエイトリンクチェック（AffiliateCTAコンポーネントまたは直リンク）
  const hasAffiliateLink =
    content.includes('<AffiliateCTA') ||
    content.includes('a8.net') ||
    content.includes('accesstrade') ||
    content.includes('affiliate') ||
    content.includes('tc-link') ||
    content.includes('valuecommerce');
  if (!hasAffiliateLink) {
    warnings.push('アフィリエイトリンクが見当たらない（AffiliateCTAコンポーネントまたはASPリンクを確認してください）');
  }

  // heroImage存在チェック
  if (!content.includes('heroImage:')) {
    warnings.push('heroImageがない（設定推奨）');
  }

  // カテゴリチェック
  if (!content.includes('category:')) {
    warnings.push('categoryがない');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    charCount,
  };
}

// CLI直接実行時
if (process.argv[1].endsWith('quality-gate.mjs')) {
  import('fs').then(({ readFileSync }) => {
    const filePath = process.argv[2];
    if (!filePath) {
      console.error('Usage: node scripts/quality-gate.mjs <path/to/article.mdx>');
      process.exit(1);
    }
    const content = readFileSync(filePath, 'utf-8');
    const slug = filePath.split('/').pop().replace('.mdx', '');
    const result = checkArticle(content, slug);
    console.log(`\n[品質チェック] ${slug}`);
    console.log(`文字数: ${result.charCount.toLocaleString()}字`);
    if (result.errors.length > 0) {
      console.log('\n❌ エラー:');
      result.errors.forEach(e => console.log(`  - ${e}`));
    }
    if (result.warnings.length > 0) {
      console.log('\n⚠️  警告:');
      result.warnings.forEach(w => console.log(`  - ${w}`));
    }
    if (result.ok) {
      console.log('\n✅ 品質チェック通過');
    } else {
      console.log('\n❌ 品質チェック失敗');
      process.exit(1);
    }
  });
}

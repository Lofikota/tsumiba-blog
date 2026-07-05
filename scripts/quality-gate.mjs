#!/usr/bin/env node
/**
 * 自動品質チェック — 記事公開前に必ず通す
 * 戻り値: { ok: boolean, errors: string[], warnings: string[] }
 */


import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// affiliateLinks.ts から live(affiliate) slugセットを構築
function buildAffiliateSlugs() {
  try {
    const code = fs.readFileSync(path.join(ROOT, 'src/data/affiliateLinks.ts'), 'utf-8');
    const slugs = new Set();
    const blockRe = /\{[^{}]+slug:\s*'([^']+)'[^{}]+\}/gs;
    let m;
    while ((m = blockRe.exec(code)) !== null) {
      const block = m[0];
      const slug   = block.match(/slug:\s*'([^']+)'/)?.[1];
      const status = block.match(/status:\s*'([^']+)'/)?.[1];
      if (slug && status === 'affiliate') slugs.add(slug);
    }
    return slugs;
  } catch { return new Set(); }
}

const AFFILIATE_SLUGS = buildAffiliateSlugs();

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

  // pending/未登録 affiliateリンクが使われていないかチェック（収益ゼロ防止）
  const productRe = /product="([^"]+)"/g;
  let pm;
  while ((pm = productRe.exec(content)) !== null) {
    const p = pm[1];
    if (!AFFILIATE_SLUGS.has(p)) {
      errors.push(`product="${p}" は未承認(pending)または未登録のアフィリエイトリンクです。` +
        ` affiliateLinks.tsでstatus:'affiliate'になっているslugに変更してください。`);
    }
  }

  // heroImage存在チェック
  if (!content.includes('heroImage:')) {
    warnings.push('heroImageがない（設定推奨）');
  }

  // カテゴリチェック
  if (!content.includes('category:')) {
    warnings.push('categoryがない');
  }

  // frontmatterスキーマ検証（正: src/content.config.ts のZodスキーマ）
  // 実例(2026-07-05): articleType「収益記事」(enum外)と実在しないheroImageがこのゲートを素通りしビルドを落とした
  const fm = (content.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const VALID_ARTICLE_TYPES = ['review', 'guide', 'comparison', 'news'];
  const articleType = fm.match(/^articleType:\s*['"]?([^'"\n]+?)['"]?\s*$/m)?.[1]?.trim();
  if (articleType && !VALID_ARTICLE_TYPES.includes(articleType)) {
    errors.push(`articleType「${articleType}」はスキーマ外（${VALID_ARTICLE_TYPES.join('/')}のいずれか）`);
  }
  const heroImage = fm.match(/^heroImage:\s*['"]?([^'"\n]+?)['"]?\s*$/m)?.[1]?.trim();
  if (heroImage && heroImage.startsWith('/') && !fs.existsSync(path.join(ROOT, 'public', heroImage))) {
    errors.push(`heroImage「${heroImage}」が public/ に存在しない`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    charCount,
  };
}

// generate-article.mjsの自動修復を通らない経路（publish-draft・CLI）用のMDX構文検証。
// 実例(2026-07-05): MDX非対応の `{#id}` アンカー構文がビルド全体を落とした
export async function checkMdxCompile(content) {
  const { compile } = await import('@mdx-js/mdx');
  try {
    await compile(content.replace(/^---\n[\s\S]*?\n---\n/, ''));
    return null;
  } catch (e) {
    const line = e.line ?? e.place?.start?.line ?? e.place?.line;
    return `MDXコンパイル不能${line ? `（本文${line}行目付近）` : ''}: ${String(e.message).slice(0, 160)}`;
  }
}

// CLI直接実行時
if (process.argv[1]?.endsWith('quality-gate.mjs')) {
  import('fs').then(async ({ readFileSync }) => {
    const filePath = process.argv[2];
    if (!filePath) {
      console.error('Usage: node scripts/quality-gate.mjs <path/to/article.mdx>');
      process.exit(1);
    }
    const content = readFileSync(filePath, 'utf-8');
    const slug = filePath.split('/').pop().replace('.mdx', '');
    const result = checkArticle(content, slug);
    const mdxError = await checkMdxCompile(content);
    if (mdxError) {
      result.errors.push(mdxError);
      result.ok = false;
    }
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

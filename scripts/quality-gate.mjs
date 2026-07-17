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

// ── 生成再注入ゲート（C10C-G 2026-07-17・P0-C10実体検証§3(b)対応）──
// LLM生成物がscope外推奨・JFX誤情報・未証明体験・ASP内部報酬額を持ち込むのを
// 最終ゲートで決定論的に拒否する。語句の言及自体は注意喚起記事で正当なため、
// 文単位で「推奨・可能形の文脈」との共起だけを拒否し、否定形・注意喚起文は通す。

// 1. scope外語句（海外FX・CFD・KO・FXスクール・EA運用）の推奨・誘導文脈
const SCOPE_TERMS = [
  { re: /海外\s*FX/i, label: '海外FX' },
  { re: /(?<![A-Za-z])CFD(?![A-Za-z])/, label: 'CFD' },
  { re: /ノックアウト・?オプション|ノックアウト注文/, label: 'ノックアウトオプション' },
  { re: /FX\s*スクール/i, label: 'FXスクール' },
  { re: /自動売買|(?<![A-Za-z])EA(?![A-Za-z])|システムトレード|シストレ/i, label: 'EA・自動売買' },
];
const RECOMMEND_RE = /おすすめ|オススメ|お勧め|推奨|推せる|向いてい(?:る|ます)|最適(?!化)|狙い目|チャンス|(?:使っ|試し|始め|挑戦し)てみ(?:ましょう|よう|てください|る価値|るのも)|始め(?:ましょう|るなら)|活用(?:しましょう|するのが)|選(?:びましょう|ぶべき)|通(?:いましょう|うのが最短)|検討(?:する価値|しましょう|してみ)/;
// 推奨語の直後が否定なら推奨ではない（「おすすめしません」等）
const RECOMMEND_NEG_TAIL_RE = /^(?:は)?(?:しません|しない|できません|できない|されません|しづらい|しにくい|(?:を行う|する)もの(?:で(?:は)?)?ありません)/;
// 文全体が明確な注意喚起・却下なら通す（言及＝正当な比較・警告記事）
const DISSUADE_RE = /おすすめ(?:しません|できません|しない|できない)|推奨(?:しません|できません|しない|されていません|(?:を行う|する)もの(?:で(?:は)?)?ありません)|やめ(?:ておきましょう|た方が|ておいた方が|るべき)|避け(?:ましょう|るべき|てください|た方が)|手を出さない|扱いません|対象外|取り上げません|紹介していません|当サイトでは(?:紹介|推奨)しません|危険性|注意点|リスクが(?:大き|高)|違法|詐欺|トラブル/;

// 2. JFX不変条件: MT4はチャート分析専用（発注・ポジション管理・EA自動売買は不可）
const JFX_CONTEXT_RE = /JFX|MATRIX\s*TRADER|マトリックス・?トレーダー/i;
// 「チャート分析対応」は正しい主張（分析専用が正）なので lookbehind で除外。
// 「対応状況/可否」等の中立な言及、「使えばいい？」等の疑問形、「できず」等の否定形も除外。
const JFX_MT4_CAPABLE_RE = /MT4[^、,]{0,16}?(?:(?<!分析)に対応|(?<!チャート分析)(?<!分析)対応(?!状況|可否|状態|一覧|の(?:違い|有無))|が使え(?!ない|ません|ず|ば)|を使え(?!ない|ません|ず|ば)|で(?:発注|注文|取引|売買|自動売買)|でも?EA|を?動かせ(?!ない|ません|ず|ば))/i;
const JFX_EA_CAPABLE_RE = /(?:EA|自動売買)[^、,]{0,24}?(?:動かせ(?!ない|ません|ず)|使え(?!ない|ません|ず|ば)|でき(?!ない|ません|ず)|可能|に対応|向いてい)/i;
const JFX_NEG_RE = /不可|できない|できません|できず|使えない|使えません|使えず|動かせない|動かせません|動かせず|非対応|対応していません|対応しません|(?:チャート)?分析専用|とは?違い|とは異なり|一方/;

// 3. 未証明の一人称利用体験・第三者の成果表現
const UNPROVEN_EXPERIENCE_PATTERNS = [
  // 「自分」は読者への呼びかけ（「自分が取引したい通貨ペア」等）で頻出するため主語に含めない
  { re: /(?:編集部|筆者|私|僕)(?:が|は|も|たち|一同)?[^。\n]{0,24}?(?:口座を?開設(?:し|して)|使っ(?:た|て(?:み|きた|いる))|試し(?:た|て)|取引し(?:た|て)|運用し(?:た|て)|儲かっ|損し(?:た|て))/, label: '編集部・筆者の一人称利用体験' },
  { re: /編集部(?:の|が試した)?体験談/, label: '編集部の体験談' },
  { re: /(?:読者|フォロワー|知人|友人|ユーザー|受講生)の?\s*[A-ZＡ-Ｚa-zａ-ｚ]?\s*さん[^。\n]{0,40}?(?:利益|勝ち|勝て|稼(?:い|げ)|儲(?:か|け)|プラスに|資産(?:が|を)増)/, label: '読者・第三者の成果表現' },
];

// 4. ASP報酬額（内部管理値。読者向けページに載せてはならない）
const ASP_REWARD_PATTERNS = [
  { re: /\d[\d,，]*\s*円\s*[/／]\s*件/, label: '「◯円/件」形式の報酬額' },
  { re: /(?:成果報酬|報酬単価|アフィリエイト報酬|承認報酬)[^。\n]{0,16}?\d[\d,，]*\s*円/, label: '報酬語＋金額' },
  { re: /1件(?:あたり|につき)[^。\n]{0,8}?\d[\d,，]*\s*円/, label: '「1件あたり◯円」形式の報酬額' },
];

// 本文を文単位に分割（frontmatter・import・リンクURL・HTMLタグを除去してから）
function splitSentences(content) {
  const text = content
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/^import .+$/gm, '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<[^>]+>/g, '');
  return text.split(/[。\n]/).map(s => s.trim()).filter(Boolean);
}

// 生成再注入チェック本体。拒否理由の配列を返す（空=通過）
export function checkInjectionSafety(content) {
  const errors = [];
  const sentences = splitSentences(content);

  for (const s of sentences) {
    // 1. scope外語句の推奨文脈
    for (const { re, label } of SCOPE_TERMS) {
      if (!re.test(s)) continue;
      const m = RECOMMEND_RE.exec(s);
      if (!m) continue;
      if (RECOMMEND_NEG_TAIL_RE.test(s.slice(m.index + m[0].length))) continue;
      if (DISSUADE_RE.test(s)) continue;
      errors.push(`scope外語句「${label}」の推奨・誘導文脈: 「${s.slice(0, 60)}」`);
    }

    // 2. JFX不変条件（MT4はチャート分析専用）
    if (JFX_CONTEXT_RE.test(s) && !JFX_NEG_RE.test(s)) {
      if (JFX_MT4_CAPABLE_RE.test(s)) {
        errors.push(`JFX不変条件違反（MT4は分析専用・発注/EA不可が正）: 「${s.slice(0, 60)}」`);
      } else if (JFX_EA_CAPABLE_RE.test(s)) {
        errors.push(`JFX不変条件違反（EA・自動売買は不可が正）: 「${s.slice(0, 60)}」`);
      }
    }

    // 3. 未証明の一人称利用体験・第三者成果
    for (const { re, label } of UNPROVEN_EXPERIENCE_PATTERNS) {
      if (re.test(s)) {
        errors.push(`未証明の利用体験・成果表現（${label}）: 「${s.slice(0, 60)}」`);
      }
    }

    // 4. ASP報酬額
    for (const { re, label } of ASP_REWARD_PATTERNS) {
      if (re.test(s)) {
        errors.push(`ASP報酬額の露出（${label}・内部管理値は本文に書かない）: 「${s.slice(0, 60)}」`);
      }
    }
  }
  return errors;
}

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

  // 生成再注入チェック（scope外推奨・JFX不変条件・未証明体験・ASP報酬額）
  errors.push(...checkInjectionSafety(content));

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

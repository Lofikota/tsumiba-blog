#!/usr/bin/env node
/**
 * 段落80字チェック（報告のみ・自動修正はしない）
 *
 * 正本: AI運用/戦略/ブログ視認性デザイン基準_リベ大型.md §2「段落: 80字以内（例外なし）」
 * 型:   /Users/kudokota/AI-Second-Brain/wiki/media/媒体設計OS_教室型メディア.md L4物理層
 *
 * 「読みやすく書く」は担当が替わると崩れるが、80字という物理制約は崩れない。
 * このスクリプトは制約を機械で測るだけで、記事は書き換えない（修正は人間レビュー経由）。
 *
 * 使い方:
 *   node scripts/check-paragraph-length.mjs                    # 全記事
 *   node scripts/check-paragraph-length.mjs fx-spread-hikaku   # slug指定
 *   node scripts/check-paragraph-length.mjs --summary          # 件数だけ
 *   node scripts/check-paragraph-length.mjs --strict           # 違反ありで exit 1
 *
 * cwd非依存: Affiliate/ ルート（check-article-workflow.mjs）から呼ばれても動く。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const blogDir = path.resolve(scriptDir, '..', 'src', 'content', 'blog');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const summaryOnly = args.includes('--summary');
const maxIndex = args.indexOf('--max');
const MAX_CHARS = maxIndex >= 0 && args[maxIndex + 1] ? Number(args[maxIndex + 1]) : 80;
const HEAD_CHARS = 30;

const targets = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--max');

/** 本文として数えない行かどうか（見出し・表・リスト・引用・水平線・JSX・import） */
function isNonProseLine(line) {
  const t = line.trim();
  if (t === '') return true;
  if (t.startsWith('#')) return true;
  if (t.startsWith('|')) return true;
  if (t.startsWith('>')) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return true;
  if (/^([-*+]|\d+\.)\s/.test(t)) return true;
  if (/^import\s/.test(t)) return true;
  if (/^export\s/.test(t)) return true;
  if (t.startsWith('<')) return true;
  if (t.startsWith('}')) return true; // JSX props の閉じ
  return false;
}

/**
 * 文字数の計測対象だけを残す。
 * markdownリンクはリンクテキストだけを残す（内部リンクが多い記事を不当に違反にしないため）。
 */
function toCountableText(raw) {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // 画像は本文の文字数ではない
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // リンクはテキストのみ
    .replace(/<[^>]+>/g, '')                   // インラインJSX/HTMLタグ
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|~~|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 1ファイルを段落へ分割して違反を返す */
function findViolations(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const violations = [];

  let inFrontmatter = false;
  let inCodeFence = false;
  let inJsxBlock = false;
  let buffer = [];
  let bufferStartLine = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = toCountableText(buffer.join(''));
    const chars = Array.from(text).length;
    if (chars > MAX_CHARS) {
      violations.push({
        line: bufferStartLine,
        chars,
        head: Array.from(text).slice(0, HEAD_CHARS).join(''),
      });
    }
    buffer = [];
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();

    if (lineNo === 1 && trimmed === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (trimmed === '---') inFrontmatter = false;
      return;
    }

    if (trimmed.startsWith('```')) {
      flush();
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;

    // 複数行にまたがるJSXコンポーネント（<ReaderNav items={[ ... ]} /> 等）
    if (inJsxBlock) {
      if (trimmed.endsWith('/>') || trimmed.startsWith('</') || trimmed.endsWith('>')) inJsxBlock = false;
      return;
    }
    if (trimmed.startsWith('<') && !trimmed.endsWith('>') && !trimmed.endsWith('/>')) {
      flush();
      inJsxBlock = true;
      return;
    }

    if (isNonProseLine(line)) {
      flush();
      return;
    }

    if (buffer.length === 0) bufferStartLine = lineNo;
    buffer.push(trimmed);

    // 行末2スペース・バックスラッシュ = markdownのハード改行。
    // DOM上は同じ<p>だが画面上は改行されるため「文字の壁」にはならない。
    // 基準の目的（スマホ1画面に文字の壁を作らない）に合わせて段落境界として扱う。
    if (/(\s{2,}|\\)$/.test(line.replace(/\n$/, ''))) flush();
  });

  flush();
  return violations;
}

function resolveTargets() {
  if (!fs.existsSync(blogDir)) {
    console.error(`記事ディレクトリが見つかりません: ${blogDir}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    return fs
      .readdirSync(blogDir)
      .filter((name) => name.endsWith('.mdx'))
      .sort()
      .map((name) => path.join(blogDir, name));
  }
  return targets.map((t) => {
    if (t.endsWith('.mdx') && fs.existsSync(t)) return path.resolve(t);
    return path.join(blogDir, `${t.replace(/\.mdx$/, '')}.mdx`);
  });
}

const files = resolveTargets();
let totalViolations = 0;
let filesWithViolations = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`⚠️  記事が見つかりません: ${path.basename(file)}`);
    continue;
  }
  const violations = findViolations(file);
  if (violations.length === 0) continue;

  totalViolations += violations.length;
  filesWithViolations += 1;
  const rel = path.relative(path.resolve(scriptDir, '..'), file);

  if (summaryOnly) {
    console.log(`${rel}: ${violations.length}件`);
    continue;
  }

  console.log(`\n${rel} — ${violations.length}件`);
  for (const v of violations) {
    console.log(`  ${rel}:${v.line} / ${v.chars}字 / ${v.head}…`);
  }
}

console.log(
  `\n段落${MAX_CHARS}字チェック: ${files.length}記事中 ${filesWithViolations}記事 / 違反 ${totalViolations}件` +
    (totalViolations > 0 ? '（報告のみ。自動修正はしない — 修正は人間レビュー経由）' : ''),
);

process.exit(strict && totalViolations > 0 ? 1 : 0);

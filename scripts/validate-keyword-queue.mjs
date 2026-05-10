#!/usr/bin/env node
/**
 * keyword-queue.json の事前検証。
 *
 * GitHub Actions の最初に実行し、壊れたキューや既存記事と衝突する
 * pending を後段へ渡さないためのガード。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const QUEUE_PATH = path.join(ROOT, 'data/keyword-queue.json');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const ALLOWED_STATUSES = new Set([
  'pending',
  'published',
  'skipped',
  'quality_failed',
  'draft',
  'needs_review',
]);

function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`);
}

function label(index, item) {
  return `#${index + 1}${item?.slug ? ` (${item.slug})` : ''}`;
}

if (!fs.existsSync(QUEUE_PATH)) {
  console.error('data/keyword-queue.json が見つかりません。');
  process.exit(1);
}

let queue;
try {
  queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
} catch (error) {
  console.error(`keyword-queue.json のJSON解析に失敗しました: ${error.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
const seenSlugs = new Map();
const seenKeywords = new Map();

if (!Array.isArray(queue)) {
  errors.push('keyword-queue.json は配列である必要があります。');
} else {
  queue.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`${label(index, item)}: オブジェクトではありません。`);
      return;
    }

    const slug = String(item.slug || '').trim();
    const keyword = String(item.keyword || '').trim();
    const status = String(item.status || '').trim();

    if (!slug) errors.push(`${label(index, item)}: slug がありません。`);
    if (slug && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      errors.push(`${label(index, item)}: slug は小文字英数字とハイフンのみです。`);
    }

    if (!keyword) errors.push(`${label(index, item)}: keyword がありません。`);
    if (!status) errors.push(`${label(index, item)}: status がありません。`);
    if (status && !ALLOWED_STATUSES.has(status)) {
      errors.push(`${label(index, item)}: status "${status}" は許可外です。`);
    }

    if (slug) {
      if (seenSlugs.has(slug)) {
        errors.push(`${label(index, item)}: slug が重複しています（先行: #${seenSlugs.get(slug) + 1}）。`);
      }
      seenSlugs.set(slug, index);
    }

    if (keyword) {
      const normalizedKeyword = keyword.toLowerCase();
      if (seenKeywords.has(normalizedKeyword)) {
        errors.push(`${label(index, item)}: keyword が重複しています（先行: #${seenKeywords.get(normalizedKeyword) + 1}）。`);
      }
      seenKeywords.set(normalizedKeyword, index);
    }

    if (status === 'pending') {
      for (const field of ['type', 'category']) {
        if (!String(item[field] || '').trim()) {
          errors.push(`${label(index, item)}: pending には ${field} が必要です。`);
        }
      }

      const articlePath = path.join(BLOG_DIR, `${slug}.mdx`);
      if (slug && fs.existsSync(articlePath)) {
        errors.push(`${label(index, item)}: pending ですが同名の記事が既に存在します。status を見直してください。`);
      }
    }

    if (status === 'published') {
      const articlePath = path.join(BLOG_DIR, `${slug}.mdx`);
      if (slug && !fs.existsSync(articlePath)) {
        warnings.push(`${label(index, item)}: published ですが src/content/blog/${slug}.mdx がありません。`);
      }
    }
  });
}

const pendingItems = Array.isArray(queue) ? queue.filter((item) => item?.status === 'pending') : [];
const next = pendingItems[0];

setOutput('has_pending', pendingItems.length > 0 ? 'true' : 'false');
setOutput('pending_count', pendingItems.length);
setOutput('next_slug', next?.slug || '');
setOutput('next_keyword', next?.keyword || '');

console.log(`keyword-queue: total=${Array.isArray(queue) ? queue.length : 0}, pending=${pendingItems.length}`);
if (next) {
  console.log(`next: ${next.slug} / ${next.keyword}`);
}

if (warnings.length > 0) {
  console.warn('\n警告:');
  warnings.forEach((warning) => console.warn(`  - ${warning}`));
}

if (errors.length > 0) {
  console.error('\nキュー検証エラー:');
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

console.log('keyword-queue 検証OK');

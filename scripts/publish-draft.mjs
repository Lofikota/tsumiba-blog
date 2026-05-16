#!/usr/bin/env node
/**
 * 下書きを公開記事へ昇格する。
 *
 * 使い方:
 *   npm run draft:publish -- <slug>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArticle } from './quality-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const slug = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

if (!slug) {
  console.error('Usage: node scripts/publish-draft.mjs <slug>');
  process.exit(1);
}

const draftDir = path.join(ROOT, 'data/article-drafts');
const draftPath = path.join(draftDir, `${slug}.mdx`);
const draftIndexPath = path.join(draftDir, 'index.json');
const articlePath = path.join(ROOT, 'src/content/blog', `${slug}.mdx`);
const queuePath = path.join(ROOT, 'data/keyword-queue.json');

if (!fs.existsSync(draftPath)) {
  console.error(`下書きが見つかりません: data/article-drafts/${slug}.mdx`);
  process.exit(1);
}

if (fs.existsSync(articlePath)) {
  console.error(`公開記事がすでに存在します: src/content/blog/${slug}.mdx`);
  process.exit(1);
}

const content = fs.readFileSync(draftPath, 'utf-8');
const qcResult = checkArticle(content, slug);

console.log(`[公開前チェック] ${slug}`);
console.log(`文字数: ${qcResult.charCount.toLocaleString()}字`);

if (!qcResult.ok) {
  console.error('\n品質チェック失敗:');
  qcResult.errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

if (qcResult.warnings.length > 0) {
  console.log('\n警告:');
  qcResult.warnings.forEach((warning) => console.log(`  - ${warning}`));
}

fs.mkdirSync(path.dirname(articlePath), { recursive: true });
fs.copyFileSync(draftPath, articlePath);

if (fs.existsSync(queuePath)) {
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  const item = queue.find((entry) => entry.slug === slug);
  if (item) {
    item.status = 'published';
    item.publishedAt = new Date().toISOString();
    delete item.draftedAt;
    fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
  }
}

if (fs.existsSync(draftIndexPath)) {
  const entries = JSON.parse(fs.readFileSync(draftIndexPath, 'utf-8'));
  const updated = entries.map((entry) => (
    entry.slug === slug
      ? { ...entry, status: 'published', publishedAt: new Date().toISOString(), articlePath: `src/content/blog/${slug}.mdx` }
      : entry
  ));
  fs.writeFileSync(draftIndexPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
}

console.log(`\n公開記事へ昇格しました: src/content/blog/${slug}.mdx`);
console.log('次に実行: npm run build');

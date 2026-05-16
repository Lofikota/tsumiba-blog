#!/usr/bin/env node
/**
 * keyword-queue.json から pending を1件取得し、記事を生成する。
 * 通常は src/content/blog/ に保存するが、--draft または ARTICLE_OUTPUT_MODE=draft では
 * data/article-drafts/ に下書き保存して、管理画面で手動公開できる状態にする。
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArticle } from './quality-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const draftMode = args.includes('--draft') || process.env.ARTICLE_OUTPUT_MODE === 'draft';

const queuePath = path.join(ROOT, 'data/keyword-queue.json');
const draftDir = path.join(ROOT, 'data/article-drafts');
const draftIndexPath = path.join(draftDir, 'index.json');
const runReportDir = path.join(ROOT, 'KPI管理/automation-runs');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));

function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`);
}

function readDraftIndex() {
  if (!fs.existsSync(draftIndexPath)) return [];
  return JSON.parse(fs.readFileSync(draftIndexPath, 'utf-8'));
}

function writeDraftIndex(entries) {
  fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(draftIndexPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
}

function upsertDraftEntry(entry) {
  const entries = readDraftIndex().filter((item) => item.slug !== entry.slug);
  entries.unshift(entry);
  writeDraftIndex(entries);
}

function writeRunReport({ pending, qcResult, reportPath, status }) {
  fs.mkdirSync(runReportDir, { recursive: true });
  const lines = [
    `# 記事生成ログ: ${pending.slug}`,
    '',
    `- 実行日時: ${new Date().toISOString()}`,
    `- slug: ${pending.slug}`,
    `- keyword: ${pending.keyword}`,
    `- category: ${pending.category}`,
    `- status: ${status}`,
    `- 文字数: ${qcResult.charCount.toLocaleString()}字`,
    '',
    '## 参照ルール',
    '',
    '- CLAUDE.md の記事制作80/20バケツリレー',
    '- AI運用/記事制作_80-20バケツリレー運用.md',
    '- AI運用/blog-operation-principles.md',
    '- 金融/YMYL記事は公式確認とリスク表記を前提にする',
  ];
  if (qcResult.warnings.length > 0) {
    lines.push('', '## 警告', '');
    qcResult.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf-8');
}

const pending = queue.find((item) => item.status === 'pending');
if (!pending) {
  console.log('キューに pending の記事がありません。終了します。');
  setOutput('status', 'no_pending');
  process.exit(0);
}

const articlePath = path.join(ROOT, 'src/content/blog', `${pending.slug}.mdx`);
const draftPath = path.join(draftDir, `${pending.slug}.mdx`);
if (fs.existsSync(articlePath)) {
  pending.status = 'skipped';
  fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
  setOutput('status', 'skipped');
  setOutput('slug', pending.slug);
  process.exit(0);
}
if (draftMode && fs.existsSync(draftPath)) {
  pending.status = 'draft';
  pending.draftedAt = pending.draftedAt || new Date().toISOString();
  fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
  setOutput('status', 'draft_exists');
  setOutput('slug', pending.slug);
  setOutput('article_path', `data/article-drafts/${pending.slug}.mdx`);
  process.exit(0);
}

const today = new Date().toISOString().split('T')[0];
const stylePath = path.join(ROOT, 'src/content/blog/credit-card-osusume.mdx');
const styleSample = fs.existsSync(stylePath)
  ? fs.readFileSync(stylePath, 'utf-8').replace(/^---[\s\S]*?---\n/, '').slice(0, 1800)
  : '';

const system = `あなたは田中蓮の金融アフィリエイトブログのライターです。目的は X -> Blog -> LINE -> Affiliate conversion で収益化することです。\n\n必須ルール:\n- MDXとしてそのまま保存できる完全な記事を書く\n- frontmatterに title, description, pubDate, updatedDate, category, tags, heroImage, affiliate, articleType を含める\n- pubDateとupdatedDateは ${today}\n- 本文冒頭に「> アフィリエイト広告を含みます」を入れる\n- 本文4,500字以上\n- 金融・投資・クレカ・保険はリスク、条件、公式確認の必要性を書く\n- 「確実に儲かる」「絶対に損しない」「必ず増える」「誰でも稼げる」は禁止\n- 読者の悩み、比較軸、次の行動を明確にし、CTAは1主導線に寄せる\n- 管理画面で人間が確認してから公開する下書きとして書く\n\n文体参考:\n${styleSample}`;

const user = `以下の条件でブログ記事をMDX形式で書いてください。コードブロックで囲まず、frontmatterから本文末尾までをそのまま出力してください。\n\nslug: ${pending.slug}\nメインKW: ${pending.keyword}\n記事タイプ: ${pending.type}\nカテゴリ: ${pending.category}\n補足: ${pending.notes || 'なし'}\nchannel: ${pending.channel || 'manual'}`;

console.log(`記事を生成中: ${pending.slug} (${draftMode ? 'draft' : 'publish'})`);
const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 8192,
  system,
  messages: [{ role: 'user', content: user }],
});

const generatedContent = response.content[0].text;
const qcResult = checkArticle(generatedContent, pending.slug);
console.log(`[品質チェック] 文字数: ${qcResult.charCount.toLocaleString()}字`);
if (!qcResult.ok) {
  pending.status = 'quality_failed';
  pending.failReason = qcResult.errors.join('; ');
  fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
  setOutput('status', 'quality_failed');
  setOutput('slug', pending.slug);
  qcResult.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const savePath = draftMode ? draftPath : articlePath;
fs.mkdirSync(path.dirname(savePath), { recursive: true });
fs.writeFileSync(savePath, generatedContent, 'utf-8');

const reportPath = path.join(runReportDir, `${today}-${pending.slug}-daily-article.md`);
writeRunReport({ pending, qcResult, reportPath, status: draftMode ? 'draft' : 'published' });

if (draftMode) {
  const draftedAt = new Date().toISOString();
  pending.status = 'draft';
  pending.draftedAt = draftedAt;
  upsertDraftEntry({
    slug: pending.slug,
    keyword: pending.keyword,
    type: pending.type,
    category: pending.category,
    channel: pending.channel || 'manual',
    priority: pending.priority ?? null,
    charCount: qcResult.charCount,
    status: 'draft',
    draftedAt,
    draftPath: `data/article-drafts/${pending.slug}.mdx`,
    reportPath: `KPI管理/automation-runs/${path.basename(reportPath)}`,
    warnings: qcResult.warnings,
  });
} else {
  pending.status = 'published';
  pending.publishedAt = new Date().toISOString();
}
fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');

setOutput('status', draftMode ? 'draft' : 'published');
setOutput('slug', pending.slug);
setOutput('char_count', qcResult.charCount);
setOutput('article_path', draftMode ? `data/article-drafts/${pending.slug}.mdx` : `src/content/blog/${pending.slug}.mdx`);
setOutput('report_path', `KPI管理/automation-runs/${path.basename(reportPath)}`);
console.log(`保存完了: ${path.relative(ROOT, savePath)}`);

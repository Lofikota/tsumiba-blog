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

const pending = queue
  .filter((item) => item.status === 'pending')
  .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))[0];
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

const system = `あなたは田中蓮（32歳・IT会社員・副業月20万円）の金融アフィリエイトブログのライターです。
目的：X → Blog → LINE → FX口座開設 / 保険相談予約 の購買転換率を最大化すること。

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 文字数・品質ルール
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 本文：1万字を目標（最低8,000字。水増し禁止・1文字1文字が読者の判断か行動に直結する内容のみ）
- MDXとしてそのまま保存できる完全な記事を書く
- frontmatterに title, description, pubDate, updatedDate, category, tags, heroImage, affiliate, articleType を含める
- pubDateとupdatedDateは ${today}
- 本文冒頭に「> アフィリエイト広告を含みます」を入れる

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 購買心理の必須実装（7要素・全記事共通）
━━━━━━━━━━━━━━━━━━━━━━━━━━

【1】自分ごと化リード（冒頭500字）
- 読者の状況を具体的に描写（年齢・職業・感情）
- 内的独白を代弁：「やらなきゃと思ってる。でも何から始めればいいかわからない」
- 問題の三層を展開：表面問題 → 感情問題（焦り・恥） → 哲学問題（行動できない自分への苛立ち）

【2】損失フレーミング（第1章・第5章・CTAに配置）
- 「今日始めない場合のコスト」を数字で可視化する
- 例：「FP相談を先延ばしにしている間、毎月○万円の過払い保険料が続いている」
- 利益訴求より損失訴求を優先。ただし煽りは禁止（YMYL違反）

【3】社会的証明（第2章・第3章）
- 信頼できる統計・公的機関データを引用
- 田中蓮の実体験（失敗も含む）を具体的に書く
- 「完璧な成功談」は信用されない。迷いと失敗を正直に書く

【4】コミットメント階段（第3章後半〜CTA前）
- Step1（最小コミット）：「まず○○を書き出してみてください」などゼロコスト行動
- Step2（中間コミット）：自己診断チェックリスト or 計算ツール
- Step3（目標コミット）：口座開設・相談予約のCTA
- いきなりStep3に誘導しない。必ずStep1→2→3の順

【5】アンカリング（比較セクション）
- 高い基準（高レバレッジ・高額有料サービス）を先に提示してから推奨商品を紹介
- 例：「有料FP相談は1回2〜5万円。今日紹介する○○は同レベルのFPに無料で相談できます」

【6】現在バイアスの克服（第4章・CTA）
- 「今日する必要があるのは○○だけ」で最小行動を明示
- 「最短○分で申請完了」「今スマホを持っているならこの記事を読み終わる頃に申請が終わる」
- 将来の大きな行動ではなく今日の最小行動に焦点を当てる

【7】フレーミング（全体）
- リスクは必ず書く（YMYL必須）。ただしポジティブフレームで表現
- 例：「証拠金の○%が損失リスク」→「適切なロット管理で証拠金の○%を守りながら取引できる」

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 記事構造テンプレート（FX・保険共通）
━━━━━━━━━━━━━━━━━━━━━━━━━━
冒頭（500字）：自分ごと化リード
第1章（1,000字）：問題三層 + 損失フレーミング
第2章（2,000字）：知識教育 + 社会的証明 + コミットStep1
第3章（3,000字）：比較・選び方 + アンカリング + コミットStep2
第4章（1,500字）：行動手順 + 現在バイアス克服 + 即時性演出
第5章（1,000字）：Q&A（反論処理・損失回避で答える）
CTA（500字）：コミットStep3 + 損失フレーム + LINE誘導

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 法的コンプライアンス（YMYL必須・省略不可）
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 金融・保険はリスク・条件・公式確認の必要性を必ず書く
- 禁止：「確実に儲かる」「絶対に損しない」「必ず増える」「誰でも稼げる」「元本保証」
- FX記事：「外国為替証拠金取引はリスクの高い取引です」のリスク表記を記事末に入れる
- CTAは1主導線に寄せる

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 田中蓮の声
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 断定しない。「〜が選択肢です」「〜という考え方もある」
- 「正直に言うと〜」「僕も最初は怖かった」が自然
- 失敗・迷いを正直に書く（完璧ぶらない）
- 口調：32歳IT会社員・読者に寄り添う先輩・押し付けない

文体参考（MDX構造・コンポーネント使い方）:
${styleSample}`;

const user = `以下の条件でブログ記事をMDX形式で書いてください。コードブロックで囲まず、frontmatterから本文末尾までをそのまま出力してください。
購買心理の7要素（自分ごと化・損失フレーミング・社会的証明・コミットメント階段・アンカリング・現在バイアス克服・フレーミング）を記事構造に必ず実装してください。

slug: ${pending.slug}
メインKW: ${pending.keyword}
記事タイプ: ${pending.type}
カテゴリ: ${pending.category}
補足: ${pending.notes || 'なし'}
channel: ${pending.channel || 'manual'}`;

console.log(`記事を生成中: ${pending.slug} (${draftMode ? 'draft' : 'publish'})`);
const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 16000,
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

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
import { buildBrokerFactsBlock } from './broker-facts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const draftMode = args.includes('--draft') || process.env.ARTICLE_OUTPUT_MODE === 'draft';
// --dry-run: API呼び出しもキュー更新もせず、組み上がったプロンプトだけを検証する。
// 先生層に事実を直書きしなくなった以降、「正本の値がプロンプトへ届いているか」を確認する唯一の手段。
const dryRun = args.includes('--dry-run');

const queuePath = path.join(ROOT, 'data/keyword-queue.json');
const draftDir = path.join(ROOT, 'data/article-drafts');
const draftIndexPath = path.join(draftDir, 'index.json');
const runReportDir = path.join(ROOT, 'KPI管理/automation-runs');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
const CURRENT_TARGET = '少額で国内FXを始めたい、20代・スマホ中心の初心者';
const CURRENT_SCOPE_CATEGORY = 'FX・外貨';
const OUT_OF_SCOPE_PATTERNS = [
  ['海外FX', /海外\s*FX|XM\s*Trading/i],
  ['CFD', /(?<![A-Za-z])CFD(?![A-Za-z])/i],
  ['ノックアウトオプション', /ノックアウト(?:オプション)?/i],
  ['FXスクール', /FXスクール/i],
  ['EA・自動売買の実運用', /(?:自動売買|シストレ|(?<![A-Za-z])EA(?![A-Za-z])).{0,30}(?:推奨|おすすめ|向いて|運用|稼働|始め|使いたい)/i],
];
const UNVERIFIED_EXPERIENCE_PATTERNS = [
  /(?:編集部|筆者|私|僕)(?:が|は|も|たち)?[^。\n]{0,30}(?:口座を?開設|使っ(?:た|て)|試し(?:た|て)|取引し(?:た|て)|運用し(?:た|て)|儲かっ|損し)/,
  /(?:読者|フォロワー|知人|友人|ユーザー)の?\s*[A-ZＡ-Ｚa-zａ-ｚ]?\s*さん[^。\n]{0,50}(?:利益|勝ち|稼(?:い|げ)|儲(?:か|け)|資産(?:が|を)増)/,
];
const ASP_REWARD_PATTERNS = [
  /\d[\d,，]*\s*円\s*[/／]\s*件/,
  /(?:成果報酬|報酬単価|アフィリエイト報酬|承認報酬)[^。\n]{0,20}\d[\d,，]*\s*円/,
  /1件(?:あたり|につき)[^。\n]{0,12}\d[\d,，]*\s*円/,
];
// 入力ガード（先生層の指示ではなく、キューの入力を機械的に弾く最終防波堤）。
// 判定根拠の正本: AI運用/データ正本/brokers_*.yaml の brokers[id=jfx] の mt4_ea と notes。
// 正本の条件が変わったらこの正規表現も見直す（正本→ここは自動同期されない）。
const JFX_FALSE_CAPABILITY_PATTERNS = [
  /(?:JFX|MATRIX\s*TRADER)[^。\n]{0,40}MT4[^。\n]{0,20}(?:で(?:発注|注文|取引|売買|自動売買)|に対応|が?使える|を?動かせる)/i,
  /(?:JFX|MATRIX\s*TRADER)[^。\n]{0,50}(?:EA|自動売買)[^。\n]{0,20}(?:できる|動かせる|使える|可能|向いている|に対応)/i,
];
const SAFETY_NEGATION_RE = /不可|できない|できません|使えない|使えません|動かせない|動かせません|非対応|分析専用|対象外|推奨しない|おすすめしない|避ける|危険|注意/;

function getInputViolation(item) {
  if (item.category !== CURRENT_SCOPE_CATEGORY) {
    return `対象カテゴリ外: ${item.category || '未設定'}`;
  }
  const input = [item.slug, item.keyword, item.notes].filter(Boolean).join(' ');
  const blocked = OUT_OF_SCOPE_PATTERNS.find(([, pattern]) => pattern.test(input));
  if (blocked && !SAFETY_NEGATION_RE.test(input)) return `対象テーマ外: ${blocked[0]}`;
  if (UNVERIFIED_EXPERIENCE_PATTERNS.some((pattern) => pattern.test(input))) {
    return '未確認の利用体験・成果表現';
  }
  if (ASP_REWARD_PATTERNS.some((pattern) => pattern.test(input))) {
    return 'ASP内部報酬額';
  }
  if (!SAFETY_NEGATION_RE.test(input) && JFX_FALSE_CAPABILITY_PATTERNS.some((pattern) => pattern.test(input))) {
    return 'JFXのMT4/EA不変条件違反';
  }
  return null;
}

function saveQueue() {
  if (dryRun) return; // dry-runはキューの状態を一切変えない
  fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf-8');
}

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
    '- AI運用/戦略/媒体修復実行計画_2026-07-11.md の現行target/scope',
    '- AI運用/一次情報執筆ガイド.md と体験素材バンクの確認済み体験核',
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

const inputViolation = getInputViolation(pending);
if (inputViolation) {
  pending.status = 'skipped_scope';
  pending.scopeReason = inputViolation;
  saveQueue();
  setOutput('status', 'skipped_scope');
  setOutput('slug', pending.slug);
  console.log(`生成拒否: ${pending.slug}（${inputViolation}）`);
  process.exit(0);
}

const articlePath = path.join(ROOT, 'src/content/blog', `${pending.slug}.mdx`);
const draftPath = path.join(draftDir, `${pending.slug}.mdx`);
if (fs.existsSync(articlePath)) {
  pending.status = 'skipped';
  saveQueue();
  setOutput('status', 'skipped');
  setOutput('slug', pending.slug);
  process.exit(0);
}
if (draftMode && fs.existsSync(draftPath)) {
  pending.status = 'draft';
  pending.draftedAt = pending.draftedAt || new Date().toISOString();
  saveQueue();
  setOutput('status', 'draft_exists');
  setOutput('slug', pending.slug);
  setOutput('article_path', `data/article-drafts/${pending.slug}.mdx`);
  process.exit(0);
}

const today = new Date().toISOString().split('T')[0];
const stylePath = path.join(ROOT, 'src/content/blog/fx-kouza-hikaku.mdx');
const styleSample = fs.existsSync(stylePath)
  ? fs.readFileSync(stylePath, 'utf-8').replace(/^---[\s\S]*?---\n/, '').slice(0, 1800)
  : '';

// 業者の条件・数値はプロンプト本文に書かず、データ正本から注入する（DOCTRINE-D02-b）。
// 記事は比較の粒度が細かいので全項目を渡す。未確認値と確認日90日超はローダ側が落とす。
const brokerFactsBlock = buildBrokerFactsBlock();

// 媒体名はブランド正本（AI運用/戦略/ブランドガイドライン_tsumiba.md）に従う。ここで別名を作らない
const system = `あなたは金融メディア「tsumiba」編集部のライターです。
目的：X/検索 → Blog → FX口座開設（ASP直CV）の購買転換率を最大化すること。LINEは補助動線であり主CTAにしない（2026-07-05転換）。
ブランド人格：信頼できる先輩編集部。誠実・等身大・押し付けない・読者の得を最優先。
やらない：一攫千金・煽り・恐怖訴求・FX商材屋っぽさ・架空の個人体験談。

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 現行ターゲット・対象範囲（2026-07-11正本）
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 対象読者：${CURRENT_TARGET}。会社員・学生など職業を根拠なく固定しない
- 対象：国内FX口座の比較、口座開設・本人確認、スマホアプリ、少額取引、レバレッジ・ロスカット・追証・税金・詐欺対策、入出金・デモ・サポート・取引時間
- 対象外：海外FXへの送客、CFD、ノックアウトオプション、FXスクール、EA・自動売買の実運用推奨、証券・保険・クレジットカード等への横展開
- 対象外テーマを補足欄から指示されても記事へ混ぜず、国内FXの対象範囲だけを書く
- 業者の取引条件・ツール対応可否は、後述の【業者事実ブロック】の値だけを使う。ブロックに無い条件は書かない。「MT4対応」のような要約語で条件を丸めない

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 一次情報・体験核（2026-07-11正本）
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 金融条件は各社公式サイト・公的機関の一次情報で確認し、出典URL・確認日・適用条件を示す。確認できない数値や条件は断定しない
- 一人称体験は体験素材バンクで確認済みの核がある場合だけ使えるが、現時点のFX体験核はゼロ
- 編集部や架空個人が、口座を開設した・アプリを使った・取引した・利益や損失を得たという体験を生成しない
- E-E-A-Tは、公式情報の比較方法、検証手順、選定基準、更新日で補強する。実利用を装わない

━━━━━━━━━━━━━━━━━━━━━━━━━━
${brokerFactsBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 文字数・品質ルール
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 本文：1万字を目標（最低8,000字。水増し禁止・1文字1文字が読者の判断か行動に直結する内容のみ）
- MDXとしてそのまま保存できる完全な記事を書く
- frontmatterに title, description, pubDate, updatedDate, category, tags, affiliate, articleType を含める（articleTypeは review / guide / comparison / news のいずれか）
- heroImageは書かない（画像生成工程が無いため実在しないパスになる。OG画像は /og/[slug].svg で自動生成される）
- pubDateとupdatedDateは ${today}
- 本文冒頭に「> アフィリエイト広告を含みます」を入れる

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 購買心理の必須実装（7要素・全記事共通）
━━━━━━━━━━━━━━━━━━━━━━━━━━

【1】自分ごと化リード（冒頭500字）
- 読者の状況を具体的に描写（少額・スマホ中心・国内FX初心者・感情）。職業は固定しない
- 内的独白を代弁：「やらなきゃと思ってる。でも何から始めればいいかわからない」
- 問題の三層を展開：表面問題 → 感情問題（焦り・恥） → 哲学問題（行動できない自分への苛立ち）

【2】損失フレーミング（第1章・第5章・CTAに配置）
- 「今日始めない場合のコスト」を数字で可視化する
- 例：「スプレッドの差を放置すると、月10回の取引で年間○円の差になる」
- 利益訴求より損失訴求を優先。ただし煽りは禁止（YMYL違反）

【3】社会的証明（第2章・第3章）
- 信頼できる統計・公的機関データ・各社公式サイトの一次情報を出典付きで引用
- 編集部の比較検証プロセス（何をどう比べたか）を具体的に書く
- 架空の個人体験談・虚偽の運用実績は絶対に書かない（一人称の「僕の体験」は禁止）

【4】コミットメント階段（第3章後半〜CTA前）
- Step1（最小コミット）：「まず○○を書き出してみてください」などゼロコスト行動
- Step2（中間コミット）：自己診断チェックリスト or 計算ツール
- Step3（目標コミット）：口座開設のCTA
- いきなりStep3に誘導しない。必ずStep1→2→3の順

【5】アンカリング（比較セクション）
- 高い基準を先に提示してから推奨商品を紹介
- 例：「店頭外貨預金の手数料は往復2円。FXのスプレッドは同じ通貨ペアで0.2銭です」

【6】現在バイアスの克服（第4章・CTA）
- 「今日する必要があるのは○○だけ」で最小行動を明示
- 「最短○分で申請完了」「今スマホを持っているならこの記事を読み終わる頃に申請が終わる」
- 将来の大きな行動ではなく今日の最小行動に焦点を当てる

【7】フレーミング（全体）
- リスクは必ず書く（YMYL必須）。ただしポジティブフレームで表現
- 例：「証拠金の○%が損失リスク」→「適切なロット管理で証拠金の○%を守りながら取引できる」

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 記事構造テンプレート（FX記事）
━━━━━━━━━━━━━━━━━━━━━━━━━━
冒頭（500字）：自分ごと化リード
第1章（1,000字）：問題三層 + 損失フレーミング
第2章（2,000字）：知識教育 + 社会的証明 + コミットStep1
第3章（3,000字）：比較・選び方 + アンカリング + コミットStep2
第4章（1,500字）：行動手順 + 現在バイアス克服 + 即時性演出
第5章（1,000字）：Q&A（反論処理・損失回避で答える）
CTA（500字）：コミットStep3 + 損失フレーム + 口座開設への直CV誘導（FxPriorityCTAまたは比較記事へ。LINE誘導は書かない）

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 法的コンプライアンス（YMYL必須・省略不可）
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 金融商品はリスク・条件・公式確認の必要性を必ず書く
- 禁止：「確実に儲かる」「絶対に損しない」「必ず増える」「誰でも稼げる」「元本保証」
- FX記事：「外国為替証拠金取引はリスクの高い取引です」のリスク表記を記事末に入れる
- CTAは1主導線に寄せる

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ Google SEO基礎（Google検索セントラル公式・2026-07-03反映）
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 読者第一で書く。検索エンジン向けの書き方・キーワードの繰り返し・文字数の水増しはGoogleが公式に「無意味」と明言している
- AI生成コンテンツは「読者への価値の付加」が絶対条件（価値なき量産はスパムポリシー違反）。この記事にしかない付加価値（独自の比較・検証・一次データ）を必ず1つ以上入れる
- 内部リンクのアンカーテキストはリンク先の内容がわかる語句で書く（「こちら」「この記事」は禁止）
- タイトル・見出しは内容を正確に要約する。誇張・ショック狙いは禁止
- 数値・条件（スプレッド・キャンペーン等）は公式ソースの確認を前提に書き、検証日を本文に記す

━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 編集部のトーン（tsumibaブランド）
━━━━━━━━━━━━━━━━━━━━━━━━━━
- 断定しない。「〜が選択肢です」「〜という考え方もある」
- 主語は「編集部」または主語なしの客観描写。「僕」「私の体験」等の一人称ナラティブは使わない
- 比較の根拠（一次情報・検証日）を正直に書く。分からないことは分からないと書く
- 口調：読者に寄り添う誠実な編集部・押し付けない・行間ゆったり・1文短め

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

if (dryRun) {
  const dumpPath = path.join(ROOT, 'data/last-article-prompt.txt');
  fs.writeFileSync(dumpPath, `${system}\n\n===== USER =====\n${user}\n`, 'utf-8');
  console.log(`[dry-run] slug: ${pending.slug} / API未呼び出し・キュー未更新`);
  console.log(`[dry-run] systemプロンプト: ${system.length}字（うち業者事実ブロック ${brokerFactsBlock.length}字）`);
  console.log(`[dry-run] プロンプト全文: ${path.relative(ROOT, dumpPath)}`);
  process.exit(0);
}

console.log(`記事を生成中: ${pending.slug} (${draftMode ? 'draft' : 'publish'})`);
const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 16000,
  system,
  messages: [{ role: 'user', content: user }],
});

// LLM生成本文のMDX構文検証＋外科的自動修復。
// 実例(2026-07-05): 「{50万円}」等の裸ブレースがacornパース不能でビルド全体を落とした。
// エラーが出た行だけ { } をエスケープし、正常なJSXコンポーネントには触れない。
async function sanitizeMdxExpressions(content) {
  const { compile } = await import('@mdx-js/mdx');
  let text = content;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await compile(text.replace(/^---\n[\s\S]*?\n---\n/, '')); // frontmatterはMDX対象外
      return text;
    } catch (e) {
      const line = e.line ?? e.place?.start?.line ?? e.place?.line;
      if (!line) throw e;
      const fmLines = (text.match(/^---\n[\s\S]*?\n---\n/) || [''])[0].split('\n').length - 1;
      const lines = text.split('\n');
      const idx = fmLines + line - 1;
      if (idx < 0 || idx >= lines.length) throw e;
      const fixed = lines[idx].replace(/([{}])/g, '\\$1');
      if (fixed === lines[idx]) throw e; // ブレース起因でない→修復不能として上位へ
      lines[idx] = fixed;
      text = lines.join('\n');
      console.log(`[MDX自動修復] ${idx + 1}行目の { } をエスケープ`);
    }
  }
  return text;
}

let generatedContent = response.content[0].text;
try {
  generatedContent = await sanitizeMdxExpressions(generatedContent);
} catch (e) {
  pending.status = 'quality_failed';
  pending.failReason = `MDX構文修復不能: ${String(e.message).slice(0, 120)}`;
  saveQueue();
  setOutput('status', 'quality_failed');
  setOutput('slug', pending.slug);
  console.error(`MDX構文エラー（自動修復不能）: ${e.message}`);
  process.exit(1);
}
const qcResult = checkArticle(generatedContent, pending.slug);
console.log(`[品質チェック] 文字数: ${qcResult.charCount.toLocaleString()}字`);
if (!qcResult.ok) {
  pending.status = 'quality_failed';
  pending.failReason = qcResult.errors.join('; ');
  saveQueue();
  setOutput('status', 'quality_failed');
  setOutput('slug', pending.slug);
  qcResult.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const savePath = draftMode ? draftPath : articlePath;
fs.mkdirSync(path.dirname(savePath), { recursive: true });
// YMYL/FX記事は必ずCMS下書き（draft:true）で保存し、人間レビュー後にCMSで公開する
// （feedback_cms_draft_workflow 2026-06-13 準拠。LLM出力に依存せずコード側で強制）
let outputContent = generatedContent;
const fmMatch = outputContent.match(/^---\n([\s\S]*?)\n---/);
if (fmMatch && !/^draft:/m.test(fmMatch[1])) {
  outputContent = outputContent.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\ndraft: true\n---`);
}
fs.writeFileSync(savePath, outputContent, 'utf-8');

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
saveQueue();

setOutput('status', draftMode ? 'draft' : 'published');
setOutput('slug', pending.slug);
setOutput('char_count', qcResult.charCount);
setOutput('article_path', draftMode ? `data/article-drafts/${pending.slug}.mdx` : `src/content/blog/${pending.slug}.mdx`);
setOutput('report_path', `KPI管理/automation-runs/${path.basename(reportPath)}`);
console.log(`保存完了: ${path.relative(ROOT, savePath)}`);

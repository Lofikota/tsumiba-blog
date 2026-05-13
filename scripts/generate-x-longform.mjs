#!/usr/bin/env node
/**
 * X長文投稿生成スクリプト（X Premium 向け）
 *
 * generate-article.mjs と同じ品質アプローチ:
 * - yomi-teacher-prompt.md を丸ごと読み込む
 * - 実際の既存ブログ記事を文体サンプルとして使う
 * - バズ型テンプレート（L1〜L5）を選択できる
 *
 * 動作:
 * 1. 指定スラッグ or keyword-queue.json の最新 published 記事を読む
 * 2. yomi-teacher-prompt + 文体サンプルを読む
 * 3. 長文投稿（2,500〜4,000字）を1本生成
 * 4. 短文投稿（200字以内）を5本生成
 * 5. X投稿/長文ドラフト/{日付}/{slug}.md に保存（日付フォルダで自動整理）
 *
 * 使い方:
 *   node scripts/generate-x-longform.mjs
 *   node scripts/generate-x-longform.mjs --slug fx-kouza-hikaku
 *   node scripts/generate-x-longform.mjs --slug fx-kouza-hikaku --template L1
 *   npm run x:longform -- --slug fx-kakuteishinkoku-guide --template L2
 *
 * テンプレート:
 *   L1 = 失敗回避（最拡散型）
 *   L2 = 比較・判断軸（最保存型）
 *   L3 = 手順・チュートリアル（検索流入型）
 *   L4 = 体験談（信頼構築型）
 *   L5 = 問いかけ展開（エンゲージメント獲得型）
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// .env を複数の場所から探してロードする（dotenvなしで実装）
function loadEnv(...paths) {
  for (const envPath of paths) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
    break;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AFFILIATE_ROOT = path.join(ROOT, '..');

// ANTHROPIC_API_KEY を探す（X自動化/.env → ren-blog-/.env の順）
loadEnv(
  path.join(AFFILIATE_ROOT, 'X自動化/.env'),
  path.join(ROOT, '.env'),
);

// ─── 引数パース ────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
};
const requestedSlug = getArg('slug') || process.env.ARTICLE_SLUG || '';
const requestedTemplate = getArg('template') || 'L4';
// --topic モード: ブログ記事に依存せずマクロテーマから生成する
// 例: node scripts/generate-x-longform.mjs --topic "手取りが増えない焦り" --cta fx-kouza-hikaku
const requestedTopic = getArg('topic') || '';
const requestedCta = getArg('cta') || 'fx-kouza-hikaku'; // CTA先スラッグ（--topicモード用）

const VALID_TEMPLATES = ['L1', 'L2', 'L3', 'L4', 'L5'];
const template = VALID_TEMPLATES.includes(requestedTemplate) ? requestedTemplate : 'L4';

// ─── マクロトピック定義 ────────────────────────
// ブログ記事に依存せず「広い感情テーマ」から生成するためのトピック一覧
// --topic で指定されない場合のランダム候補として使う
const MACRO_TOPICS = [
  {
    id: 'paycheck-anxiety',
    emotion: '手取りが増えない焦り',
    scene: '毎月25日に給料が振り込まれる瞬間、なぜかうれしくない感覚',
    cta_slug: 'fx-kouza-hikaku',
    cta_label: 'FXで月5万を目指す最初のステップ',
  },
  {
    id: 'peer-comparison',
    emotion: '同世代に置いていかれる感覚',
    scene: 'SNSで友人のマンション購入・NISA運用報告を見て焦る',
    cta_slug: 'fx-shoshinsha-guide',
    cta_label: '副業FXを始める前に知っておきたいこと',
  },
  {
    id: 'savings-not-growing',
    emotion: '貯金しているのにお金が増えない感覚',
    scene: '預金口座の残高が1年前とほぼ同じ数字のまま',
    cta_slug: 'fx-kouza-hikaku',
    cta_label: 'お金を動かす最初の選択肢',
  },
  {
    id: 'side-hustle-lost',
    emotion: '副業を始めたいけど何から手を付ければいいかわからない',
    scene: '副業系の情報が多すぎてブックマークだけが増えていく状態',
    cta_slug: 'fx-shoshinsha-guide',
    cta_label: 'FXという選択肢の始め方',
  },
  {
    id: 'inflation-fear',
    emotion: 'インフレで貯金の価値が目減りしている不安',
    scene: 'スーパーの食料品価格・光熱費・外食費が軒並み上がっている日常',
    cta_slug: 'fx-kakuteishinkoku-guide',
    cta_label: 'お金を動かし始めた人が最初に直面すること',
  },
  {
    id: 'financial-ignorance',
    emotion: 'お金の勉強を一度もしてこなかった後悔',
    scene: '30代になって初めて「複利」という言葉の意味を調べた夜',
    cta_slug: 'fx-shoshinsha-guide',
    cta_label: 'ゼロから始めるお金の勉強の最初の一歩',
  },
];

// ─── 対象記事またはマクロトピックを決定 ────────────
let target, articleBody, articleUrl, macroTopic;

if (requestedTopic) {
  // --topic モード: 感情テーマから直接生成
  macroTopic = MACRO_TOPICS.find(t => t.emotion.includes(requestedTopic) || t.id === requestedTopic)
    || { id: 'custom', emotion: requestedTopic, scene: '', cta_slug: requestedCta, cta_label: requestedTopic };
  target = { slug: macroTopic.id, keyword: macroTopic.emotion, category: 'macro' };
  articleBody = '';
  articleUrl = `https://ren-money.com/blog/${macroTopic.cta_slug}/`;
} else {
  // 通常モード: ブログ記事ベース
  const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/keyword-queue.json'), 'utf-8'));
  target = requestedSlug
    ? queue.find(k => k.slug === requestedSlug)
    : [...queue].reverse().find(k => k.status === 'published');

  if (!target) {
    console.log('対象記事が見つかりません。終了します。');
    process.exit(0);
  }

  const mdxPath = path.join(ROOT, `src/content/blog/${target.slug}.mdx`);
  if (!fs.existsSync(mdxPath)) {
    console.error(`記事ファイルが存在しません: ${mdxPath}`);
    process.exit(1);
  }

  const articleContent = fs.readFileSync(mdxPath, 'utf-8');
  articleBody = articleContent
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/^import.*\n/gm, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  articleUrl = `https://ren-money.com/blog/${target.slug}/`;
}

// ─── yomi-teacher-prompt.md を読み込む ─────────
const teacherPromptPath = path.join(AFFILIATE_ROOT, 'AI運用/yomi-teacher-prompt.md');
const teacherPrompt = fs.existsSync(teacherPromptPath)
  ? fs.readFileSync(teacherPromptPath, 'utf-8')
  : '';

// ─── 文体サンプル（実際のブログ記事から） ─────────
const STYLE_FILES = ['fx-kouza-hikaku.mdx', 'fx-shoshinsha-guide.mdx'];
const styleExamples = STYLE_FILES
  .map(file => {
    const p = path.join(ROOT, 'src/content/blog', file);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const body = raw.replace(/^---[\s\S]*?---\n/, '').replace(/^import.*\n/gm, '').replace(/<[^>]+>/g, '');
    return `【文体サンプル: ${file}の冒頭1,200字】\n${body.slice(0, 1200)}`;
  })
  .filter(Boolean)
  .join('\n\n');

// ─── バズ型テンプレート定義 ────────────────────
const TEMPLATES = {
  L1: {
    name: '失敗回避型（最拡散）',
    structure: `
1行目: 「FXで○万円溶かした話」「FXで最初にやらかしやすい○つ」のように数字と失敗を入れる
2〜4行: 結論（何を避ければよかったか）
中盤: 失敗のメカニズム（ロスカット・レバレッジ・追証）を具体的な計算で見せる
注意点: 少額で始める理由
最後: ブログへのCTA`,
    firstLineHint: '数字と失敗を入れる。例: 「FXで最初の1週間に4,000円溶かした話。」',
  },
  L2: {
    name: '比較・判断軸型（最保存）',
    structure: `
1行目: 「FX口座を○つ試してわかった選び方」「迷う○口座を比較した」
中盤: スプレッド・スワップ・最低証拠金・MT4対応を表形式か箇条書きで整理
判断軸: どんな人が何を選ぶべきか（3パターン）
注意: 1社を強く推さず「向き不向き」で整理
最後: ブログへのCTA`,
    firstLineHint: '比較と保存欲求を誘う。例: 「4口座を実際に使って比較した。スプレッドだけで選んだら後悔した。」',
  },
  L3: {
    name: '手順・チュートリアル型（検索流入）',
    structure: `
1行目: 「FX口座の開き方を○ステップで整理した」「確定申告の前に知る○つ」
2〜3行: 対象読者を絞る
ステップ1〜N: 番号付きで手順。各ステップ1〜2文＋注意点1つ
よくある間違い: 1〜2個
最後: ブログかLINE診断`,
    firstLineHint: 'ステップ感を出す。例: 「FX確定申告、去年初めてやった手順を5ステップで整理します。」',
  },
  L4: {
    name: '体験談型（信頼構築）',
    structure: `
1行目: 「○円でFXを始めて○ヶ月経った話」「FXを怖いと思っていた自分が変わった理由」
背景: 始めた動機（副業・会社員・少額から）
失敗か発見: 具体的な出来事（金額・日数・状況）
学び: それで何を変えたか
今の状態: どうなっているか（断定的な収益訴求なし）
最後: フォローかブログへ`,
    firstLineHint: '体験と数字で始める。例: 「証拠金5万円でFXを始めて3ヶ月。正直に振り返ります。」',
  },
  L5: {
    name: '問いかけ展開型（エンゲージメント）',
    structure: `
1行目: 「FXを始めるならどっちが正解？」「○○と○○、どちらを先にやるべきか」
2行: 選択肢を並べる
中盤: 判断軸を整理（なぜそちらか）
自分の答え: 田中蓮としての選択を明かす
読者へのボール: 「あなたはどちらを選びましたか？」
最後: 参考になった人はリポスト or フォロー`,
    firstLineHint: '問いかけで始める。例: 「FXとNISA、会社員が先にやるべきはどちらか。自分なりの答えを出してみた。」',
  },
};

const selectedTemplate = TEMPLATES[template];

// ─── 短文の投稿日程（今日〜+5日）─────────────
const today = new Date();
const scheduleDates = Array.from({ length: 5 }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() + i + 1);
  return d.toISOString().slice(0, 10);
});

// ─── Anthropic クライアント ────────────────────
const client = new Anthropic();
console.log(`\n🔄 X長文・短文投稿を生成中: ${target.slug} / テンプレート: ${template}（${selectedTemplate.name}）\n`);

// ─── 長文生成 ──────────────────────────────────
const longformResponse = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 6000,
  system: `あなたは田中蓮（32歳・IT会社員）として、X Premium向けの長文投稿を書くライターです。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【田中蓮とは誰か】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
25〜27歳：浪費癖でクレカリボ払い膨張、借金200万円まで膨らんだ。
28歳：副業ライティングで返済開始。「お金を知らないまま生きていた」と気づいた転機。
30歳：NISAとiDeCo開始。月3,000円から。怖くて最初は少額しか入れられなかった。
31歳：FXをデモ口座で3ヶ月練習後にスタート。最初の本番取引で3,000円溶かした。
現在（32歳）：副業月20万・資産500万・月5万円FX運用中。
→ 田中蓮は「成功者」ではない。「普通の人が試行錯誤している途中」の人間として書く。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【コピーライティング設計原則（この投稿で最重要）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ SB7（ストーリーブランド7）の核心ルール：
「田中蓮がヒーローになってはいけない。読者がヒーローで、田中蓮はガイドだ」
→ 田中蓮の体験談は「私がすごい」を伝えるためではなく、「あなたも同じ道を通れる」を示すために使う。
→ 読者の悩み・感情・状況を先に書いてから、田中蓮の経験を引き合いに出す。

■ JTBD（ジョブ理論）の応用：
読者が求めているのは「FX口座を開くこと」（機能的ジョブ）ではない。
本当に雇いたいのは「将来の不安を消すこと」「お金で失敗した人間になりたくないこと」（感情的ジョブ）。
→ 必ずFXより前に「お金の不安」という感情から入る。FXは手段として後から登場させる。

■ エンパシーマップ（読者の内面を先に描く）：
See（読者が見ているもの）：SNSのNISA投稿・インフレニュース・友人の副業成功話
Hear（読者が聞くこと）：「老後2,000万円問題」「物価上昇」「会社員じゃ限界」
Think/Feel（読者の内面）：「自分だけ遅れている」「失敗したら取り返せない気がして怖い」「何から始めればいいかわからない」
→ 冒頭の最初の2〜3行でこの「Think/Feel」を言葉にして代弁する。読者が「自分のことだ」と感じる瞬間を作る。

■ 新PASONA（感情から入る6段構造）：
P（Problem）：読者の外的問題を1文で提示
A（Affinity）：内的感情を代弁・共感。「それは当然です」「私も同じでした」。煽らない・責めない
S（Solution）：解決策を具体的に。数字・手順・体験を入れる
O（Offer）：読者が取れる次の一歩を提示
N（Narrow down）：この情報が刺さる人を絞り込む（全員向けは誰にも刺さらない）
A（Action）：記事への誘導。押し売りにしない
→ 「A（Affinity）」を最も丁寧に書く。ここが薄いと「AIが書いた文章」に見える。

■ 4幕ストーリー構造：
幕1（日常）：読者と同じ普通の状況から始める。FXでなくお金の不安から。
幕2（転機）：何か気づきや出来事。「気づいたのが〜」「焦りを感じたのが〜」
幕3（試練と学習）：失敗・間違い・発見。具体的な金額・日数・状況を入れる。
幕4（変容）：今の状態。断定的な成功訴求はしない。「少しずつ変わってきた」レベルで十分。

■ ソフトエントリー（入口を選ぶ）：
FXの話を最初にしない。まず「お金が不安な普通の人」の話から始める。
「貯金が全然増えない感覚」「手取りが増えない焦り」「同世代に置いていかれる感覚」
→ そこからFXが自然な選択肢として登場する流れを作る。

■ 透明性原則（信頼の最大の武器）：
失敗談・迷い・「わからないこと」を正直に書く。
「私の運用がうまくいく保証はない」「向いてない人もいる」を隠さない。
→ AI生成コンテンツとの最大の差別化ポイント。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【文体ルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ひらがな多め・カジュアル。「〜です/ます」と「〜だ」を自然に混在させる
- 抽象論は書かない。失敗・数字・日付・金額の具体例から始める
- 1文は短く。長い説明は「---」や改行で区切る
- 説教しない。「一緒に考えよう」「自分もわかってなかった」スタンス
- 専門用語は必ずひとことで解説する（初出時1回だけ）
- 読者への問いかけを1〜2個入れる（「あなたはどうでしたか？」「知ってましたか？」）
- 「ソフトプッシュCTA」：最後は「興味があったら読んでみてください」レベルで終わる。押し売りは禁止

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【禁止表現】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
確実に儲かる・必ず増える・元本保証・誰でも稼げる・絶対儲かる
（「元本保証なし」「元本保証はない」という否定表現はOK）

${teacherPrompt ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【先生プロンプト（品質・文体の全ルール）】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${teacherPrompt}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【文体サンプル（この文体に近づけること）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${styleExamples}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【使う型: ${template} - ${selectedTemplate.name}】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${selectedTemplate.structure}

【1行目のヒント】
${selectedTemplate.firstLineHint}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【出力ルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- そのままXにコピペして投稿できる投稿テキストだけを出力する
- 2,500〜4,000字（長くても読み切れる設計にすること）
- 区切りは「---」を使う
- 見出しは「【】」形式
- 最後は「興味があれば読んでみてください」調のソフトCTA（ブログかLINEへ）
- JSONやコードブロックは一切使わない。投稿文のみ出力`,
  messages: [{
    role: 'user',
    content: macroTopic
      ? `【マクロトピックモード】感情テーマから${template}（${selectedTemplate.name}）のX長文投稿を1本書いてください。

感情テーマ: ${macroTopic.emotion}
情景: ${macroTopic.scene}
CTA先URL: ${articleUrl}

【生成の方針】
- FXや投資の話は後半まで出さない
- 最初の500〜800字は「${macroTopic.emotion}」という感情を持つ読者の日常・感情の描写に使う
- 田中蓮が同じ状況にいた具体的なエピソードを混ぜる
- 中盤以降に「こういう状況だったから副業とFXという選択肢を試した」という流れで登場させる
- FXは「正解」として推さない。「自分が試している選択肢のひとつ」として紹介する
- 最後にCTAへのソフトリンクを置く`
      : `以下の記事をベースに、${template}（${selectedTemplate.name}）のX長文投稿を1本書いてください。

記事URL: ${articleUrl}
テーマ: ${target.keyword}
カテゴリ: ${target.category}

【記事の内容】
${articleBody.slice(0, 6000)}`,
  }],
});

const longformText = longformResponse.content[0].text.trim();

// ─── 短文生成 ──────────────────────────────────
const shortformResponse = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 2000,
  system: `あなたは田中蓮（32歳・IT会社員）として、Xの短文投稿（200字以内）を書くライターです。

【設計原則】
- 読者がヒーロー。田中蓮は「同じ道を先に通った先輩」として登場する
- 「お金が不安な普通の人」の感情から入る。最初からFX・NISA・投資の話にしない
- Affinity（親近感）ファースト：共感・代弁から始めて、情報で終わる
- 透明性：「わからなかった」「失敗した」「向かない人もいる」を隠さない
- ソフトプッシュ：押し売り禁止。「気になったら」「興味があれば」調で終わる

【文体】カジュアル・数字と具体体験ファースト・絵文字なし・断定しない
【禁止表現】確実に儲かる・必ず増える・元本保証・誰でも稼げる・絶対儲かる

【短文5タイプのテンプレート（書き方の型）】
逆説型：「〜だと思ったけど実は逆だった」という意外な事実で興味を引く
体験談型：「自分が経験したこと」を数字・日付・状況を入れて具体的に書く
あるある型：「〜と思いがち」「〜しがちだけど実は」という読者共感を引き出す
質問型：「〜を知っていますか？」「〜はどちらを選んでいますか？」で考えさせる
数字まとめ型：箇条書き・数字で整理。保存したくなる情報密度を作る

【出力形式（JSONのみ・コードブロックなし）】
{
  "posts": [
    {"type": "逆説型", "body": "投稿本文（200字以内）"},
    {"type": "体験談型", "body": "投稿本文（200字以内）"},
    {"type": "あるある型", "body": "投稿本文（200字以内）"},
    {"type": "質問型", "body": "投稿本文（200字以内）"},
    {"type": "数字まとめ型", "body": "投稿本文（200字以内）\\n\\n詳しくはブログで→ ${articleUrl}"}
  ]
}`,
  messages: [{
    role: 'user',
    content: macroTopic
      ? `感情テーマ「${macroTopic.emotion}」をベースに、5タイプのX短文投稿を作成してください。

感情テーマ: ${macroTopic.emotion}
情景: ${macroTopic.scene}
CTA先URL: ${articleUrl}

【生成の方針】
- FXや投資の言葉を最初に出さない。まず「感情の描写」から入る
- 読者が「自分のことだ」と感じる書き出しにする
- 体験談型・逆説型はFXが出てくるとしても後半のみ
- 数字まとめ型はFX関連の内容でもOKだが「感情的なメリット」から始める`
      : `以下の記事から5タイプのX短文投稿を作成してください。

テーマ: ${target.keyword}
記事URL: ${articleUrl}

【記事の内容（冒頭2,000字）】
${articleBody.slice(0, 2000)}`,
  }],
});

let shortPosts = [];
try {
  const raw = shortformResponse.content[0].text;
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  shortPosts = JSON.parse(json).posts;
  if (!Array.isArray(shortPosts) || shortPosts.length < 5) throw new Error('posts配列不正');
} catch (e) {
  console.error('短文のJSON解析失敗:', e.message);
  shortPosts = [];
}

// ─── 品質チェック（長文）──────────────────────
const longformCharCount = longformText.length;

// 単純マッチ（文脈不問で禁止）
const BANNED_SIMPLE = ['確実に儲かる', '絶対に損しない', '必ず増える', '誰でも稼げる', '絶対儲かる'];
// 肯定的文脈のみ禁止（「元本保証なし」「元本保証はない」はOK）
const BANNED_PATTERN = /元本(が|は|を)?保証(され|しま|です|あり|する(?!がな|はな|がない|はない|なし))/;

const simpleHit = BANNED_SIMPLE.find(expr => longformText.includes(expr));
const patternHit = BANNED_PATTERN.test(longformText);

if (simpleHit) {
  console.error(`❌ 禁止表現が含まれています: 「${simpleHit}」`);
  process.exit(1);
}
if (patternHit) {
  console.error(`❌ 元本保証の肯定表現が含まれています`);
  process.exit(1);
}
if (longformCharCount < 1500) {
  console.error(`❌ 長文が短すぎます: ${longformCharCount}字（1,500字以上必須）`);
  process.exit(1);
}

// ─── 保存 ─────────────────────────────────────
// 保存先: X投稿/長文ドラフト/{日付}/ に日付フォルダを作って整理する
const today0 = today.toISOString().slice(0, 10);
const outDir = path.join(AFFILIATE_ROOT, 'X投稿/長文ドラフト', today0);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const fileSlug = macroTopic ? `macro-${macroTopic.id}` : target.slug;
const fileName = `${fileSlug}.md`;
const filePath = path.join(outDir, fileName);

const lines = [
  `# X投稿セット: ${target.keyword}`,
  ``,
  `- モード: ${macroTopic ? 'マクロトピック（感情テーマ）' : 'ブログ記事ベース'}`,
  `- スラッグ: ${fileSlug}`,
  `- 記事URL: ${articleUrl}`,
  `- 生成日: ${today0}`,
  `- 使用テンプレート: ${template}（${selectedTemplate.name}）`,
  `- 長文文字数: ${longformCharCount}字`,
  ``,
  `---`,
  ``,
  `## ■ 長文投稿（X Premiumからコピペして投稿）`,
  ``,
  `> 手順: Xのアプリを開く → 「ポスト」ボタン → 下記をそのまま貼り付けて投稿`,
  ``,
  `\`\`\``,
  longformText,
  `\`\`\``,
  ``,
  `- [ ] 投稿済み`,
  ``,
  `---`,
  ``,
  `## ■ 短文セット（翌週の投稿用・1日1本）`,
  ``,
];

if (shortPosts.length > 0) {
  shortPosts.forEach((p, i) => {
    const date = scheduleDates[i] || `+${i + 1}日`;
    lines.push(`### ${date}（${p.type}）`);
    lines.push(``);
    lines.push(p.body);
    lines.push(``);
    lines.push(`- [ ] 投稿済み`);
    lines.push(``);
  });
} else {
  lines.push(`> 短文の生成に失敗しました。手動で作成してください。`);
  lines.push(``);
}

lines.push(`---`);
lines.push(``);
lines.push(`## ■ 今週の投稿スケジュール`);
lines.push(``);
lines.push(`| 日付 | 形式 | 状態 |`);
lines.push(`|------|------|------|`);
lines.push(`| ${today0} | **長文（Premium）** | [ ] 未投稿 |`);
shortPosts.forEach((p, i) => {
  const date = scheduleDates[i] || `+${i + 1}日`;
  lines.push(`| ${date} | 短文（${p.type}） | [ ] 未投稿 |`);
});

fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

console.log(`✅ 保存完了: X投稿/長文ドラフト/${today0}/${fileName}`);
console.log(`   長文: ${longformCharCount}字`);
console.log(`   短文: ${shortPosts.length}本（${scheduleDates[0]} 〜 ${scheduleDates[4]}）`);
console.log(`\n📋 次のステップ:`);
console.log(`   1. X投稿/長文ドラフト/${today0}/${fileName} を開く`);
console.log(`   2. 「■ 長文投稿」のコードブロック内のテキストをコピー`);
console.log(`   3. Xのアプリを開いて貼り付けて投稿`);
console.log(`   4. 翌日から短文セットを1日1本投稿`);

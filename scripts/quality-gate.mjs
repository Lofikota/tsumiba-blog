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
// 最終ゲートで決定論的に拒否する。scope外語句は原則拒否し、
// 明示的な否定・対象外表明・注意喚起だけを例外として通す。

// 1. scope外語句（海外FX・CFD・KO・FXスクール・EA運用）
const SCOPE_TERMS = [
  { re: /海外\s*FX/i, label: '海外FX' },
  { re: /(?<![A-Za-z])CFD(?![A-Za-z])/, label: 'CFD' },
  { re: /ノックアウト(?:・?オプション|注文)?/, label: 'ノックアウトオプション' },
  { re: /FX\s*スクール/i, label: 'FXスクール' },
  { re: /自動売買|(?<![A-Za-z])EA(?![A-Za-z])|システムトレード|シストレ/i, label: 'EA・自動売買' },
];
// P0-C13R（2026-07-25）: 推奨語の列挙は言い換えで回避できるため廃止。
// scope外語句を含む節は原則拒否し、明示的な否定・対象外表明・注意喚起だけを許可する。
const SCOPE_HARD_NEGATION_RE = /対象外|(?:でき|使え|動かせ|選べ|始められ)(?:ません|ない|ず)|(?:おすすめ|オススメ|お勧め|推奨|紹介|掲載)(?:しません|しない|できません|できない|せず)|扱(?:いません|わない|わず|っていません|っていない)|含め(?:ません|ない)|評価(?:しません|しない|していません|していない)|られ(?:ません|ない)|不可|非対応|禁止|避け(?:る|ます|ましょう)|手を出さ(?:ない|ず)|メリット(?:が|は)?(?:ありません|ない)|元本保証[^、,]*ない|では(?:ありません|ない)|わけではない/i;
const SCOPE_PURE_WARNING_RE = /(?:デメリット|危険性|注意点?|リスク)(?:について|を|と|が|は|も|の)?[^。\n]{0,24}?(?:説明|解説|整理|確認|理解)(?:します|する|してください|が必要です|が必要だ)?$|(?:危険性|リスク)(?:が|は|も)(?:あります|ある|高い|大きい)$|無登録業者(?:が|は)?(?:多い|多く存在します|多く存在する)$/i;
const SCOPE_WARNING_CONTINUATION_RE = /(?:危険性|注意点?|リスク)(?:が|は|も)?[^。\n]{0,20}?(?:ある|高い|大きい)ため$|無登録業者(?:が|は)?多く$/i;
const SCOPE_ADVERSATIVE_RE = /ですが|ますが|ませんが|ないが|ものの|けれど(?:も)?|しかし(?:ながら)?|一方で|ただし/;
const SCOPE_CLAUSE_SPLIT_RE = new RegExp(`[、,；;]|${SCOPE_ADVERSATIVE_RE.source}`);

function hasOnlyAllowedScopeMentions(sentence) {
  const normalizedSentence = sentence.replace(/[\[\]*_]/g, '');
  const adversativeParts = normalizedSentence.split(SCOPE_ADVERSATIVE_RE);
  if (
    adversativeParts.length > 1
    && !SCOPE_HARD_NEGATION_RE.test(adversativeParts.at(-1))
    && !SCOPE_PURE_WARNING_RE.test(adversativeParts.at(-1))
  ) {
    return false;
  }

  const clauses = normalizedSentence.split(SCOPE_CLAUSE_SPLIT_RE).map(clause => clause.trim()).filter(Boolean);
  let scopeSeen = false;
  for (const [index, clause] of clauses.entries()) {
    const hasScopeTerm = SCOPE_TERMS.some(({ re }) => re.test(clause));
    if (!hasScopeTerm) continue;
    scopeSeen = true;
    // ALLOWは明示的否定か、文末まで注意喚起だけで閉じる節に限定する。
    const warningLeadsToHardNegation = SCOPE_WARNING_CONTINUATION_RE.test(clause)
      && clauses.slice(index + 1).some(nextClause => SCOPE_HARD_NEGATION_RE.test(nextClause));
    if (
      !SCOPE_HARD_NEGATION_RE.test(clause)
      && !SCOPE_PURE_WARNING_RE.test(clause)
      && !warningLeadsToHardNegation
    ) return false;
  }
  return scopeSeen;
}

// 2. JFX不変条件: MetaTraderチャートは分析専用（発注機能が未実装＝発注・ポジション管理・EA自動売買は不可）
// MT4は2026-08-19に提供終了しMT5へ移行するが、分析専用という位置づけはMT5でも変わらない
// （公式 https://www.jfx.co.jp/mt5/ 「チャート分析専用となり、発注機能は実装されていません」2026-07-26確認）。
// そのためバージョン名に依存せずMT4/MT5/MetaTraderのいずれでも検知する。
const JFX_CONTEXT_RE = /JFX|MATRIX\s*TRADER|マトリックス・?トレーダー/i;
const MT_TOKEN = 'MT(?:4|5)|MetaTrader\\s*[45]?';
// 「チャート分析対応」は正しい主張（分析専用が正）なので lookbehind で除外。
// 「対応状況/可否」等の中立な言及、「使えばいい？」等の疑問形、「できず」等の否定形も除外。
const JFX_MT4_CAPABLE_RE = new RegExp(`(?:${MT_TOKEN})(?:\\s*に)?対応|(?:${MT_TOKEN})[^。]{0,80}?(?:(?:で|から|を使って)[^。]{0,16})?(?:(?:発注|注文|取引|売買|エントリー)[^。]{0,12}?(?:でき(?!ない|ません|ず)|可能|行え|出せ)|(?:EA|自動売買)[^。]{0,18}?(?:動かせ(?!ない|ません|ず)|使え(?!ない|ません|ず)|でき(?!ない|ません|ず)|可能|対応))`, 'i');
const JFX_EA_CAPABLE_RE = /(?:EA|自動売買)[^、,]{0,24}?(?:動かせ(?!ない|ません|ず)|使え(?!ない|ません|ず|ば)|でき(?!ない|ません|ず)|可能|に対応|向いてい)/i;
const JFX_MT4_CONNECTOR_RE = new RegExp(`(?:${MT_TOKEN})[^。]{0,32}?(?:から|上で|を使って|経由で|で)([^。]{0,48})`, 'gi');
const JFX_OPERATION_RE = /発注|注文|取引|売買|エントリー|新規ポジション|(?:建玉|保有玉|保有ポジション|ポジション)[^。]{0,12}(?:保有|建て|閉じ|決済|手仕舞|クローズ|解消|変更|管理)|(?:建て|閉じ|決済|手仕舞|クローズ|解消|変更|管理)[^。]{0,12}(?:建玉|保有玉|保有ポジション|ポジション)|建て|決済|手仕舞い|クローズ|解消|利確|損切り/i;
// BROKER-F02: 公式の否定表現「発注機能は実装されていません」を正しい記述として通すため
// 「実装/搭載されていない」系を否定形に追加した（追加しないと正しい引用がゲートで落ちる）。
const JFX_OPERATION_NEGATION_RE = /できない|できません|できず|られない|られません|不可|非対応|行わない|しない|使えない|分析専用|実装されていない|実装されていません|実装されない|未実装|搭載されていない|搭載されていません/i;
const MATRIX_ORDER_PATTERNS = [
  /(?:発注|注文)(?:は|を)?[^。]{0,8}MATRIX\s*TRADER[^。]{0,18}(?:から|で)?[^。]{0,8}(?:行|実行)/gi,
  /MATRIX\s*TRADER[^。]{0,18}(?:から|で)[^。]{0,18}(?:発注|注文)[^。]{0,12}(?:行|でき)/gi,
];

function maskMatrixTraderOrders(sentence) {
  return MATRIX_ORDER_PATTERNS.reduce((masked, pattern) => masked.replace(pattern, ' '), sentence);
}

function hasAffirmativeMt4Operation(sentence) {
  for (const connectorMatch of sentence.matchAll(JFX_MT4_CONNECTOR_RE)) {
    const operationMatch = connectorMatch[1].match(JFX_OPERATION_RE);
    if (!operationMatch) continue;
    const suffix = connectorMatch[1].slice(operationMatch.index ?? 0, (operationMatch.index ?? 0) + 36);
    if (!JFX_OPERATION_NEGATION_RE.test(suffix)) return true;
  }
  return false;
}

// 3. 未証明の一人称利用体験・第三者の成果表現
const UNPROVEN_EXPERIENCE_PATTERNS = [
  // 「自分」は読者への呼びかけ（「自分が取引したい通貨ペア」等）で頻出するため主語に含めない
  { re: /(?:編集部|筆者|私|僕)(?:が|は|も|たち|一同)?[^。\n]{0,24}?(?:口座を?開設(?:し|して)|使っ(?:た|て(?:み|きた|いる))|試し(?:た|て)|取引し(?:た|て)|運用し(?:た|て)|儲かっ|損し(?:た|て))/, label: '編集部・筆者の一人称利用体験' },
  { re: /編集部(?:の|が試した)?体験談/, label: '編集部の体験談' },
  { re: /(?:読者|フォロワー|知人|友人|ユーザー|受講生)の?\s*[A-ZＡ-Ｚa-zａ-ｚ]?\s*さん[^。\n]{0,40}?(?:利益|勝ち|勝て|稼(?:い|げ)|儲(?:か|け)|プラスに|資産(?:が|を)増)/, label: '読者・第三者の成果表現' },
  { re: /(?:利用者|ユーザー|顧客|申込者|受講生|購入者)[^。\n]{0,40}?(?:利益|成果|稼げた|儲かった)[^。\n]{0,32}?(?:声|報告|届(?:いた|きました))/, label: '利用者・顧客等の成果の声' },
];
const THIRD_PARTY_SUBJECT_RE = /読者|利用者|口座利用者|ユーザー|顧客|お客様|申込者|会員|受講生|購入者|成功者|体験者|トレーダー/;
const THIRD_PARTY_RESULT_RE = /利益|稼げ|儲|成果|収益|勝て|黒字/;
const THIRD_PARTY_HEARSAY_RE = /声|好評|報告|届|寄せ|口コミ|感想|評価|投稿/;
const SOCIAL_PROOF_RE = /声|口コミ|レビュー|体験談|アンケート|コメント|回答|紹介|感想|評価|投稿/;
const SOCIAL_RESULT_RE = /利益|収益|稼|儲|成功|増え|プラス|黒字|勝(?:て|った|ち|率|てる)/;
const SOCIAL_NUMBER_RE = /(?:\d[\d,.]*|[０-９][０-９，．]*|[〇零一二三四五六七八九十百千万億]+)(?:\s*(?:円|万円|%|％|倍|件|人|か月|ヶ月|月))/;
const INTERNAL_DEAL_RE = /案件|提携プログラム|広告プログラム|アフィリエイト/;
const INTERNAL_PAYOUT_EVENT_RE = /受け取|支払|支給|入金|振込|(?:円|万円)(?:が)?(?:入る|入ります)|(?:お金|金銭|報酬|収益)[^。\n]{0,8}(?:入る|入ります)|(?:入る|入ります)[^。\n]{0,8}(?:お金|金銭|報酬|収益)|発生ベース/;
const INTERNAL_MONEY_RE = /(?:\d[\d,.]*|[０-９][０-９，．]*|[〇零一二三四五六七八九十百千万億]+)\s*(?:円|万円)/;
const INTERNAL_ECONOMICS_CONTEXT_RE = /広告|案件|提携|アフィリエイト|リンク|申込|成約|獲得|承認|契約/;
const INTERNAL_UNIT_EVENT_RE = /(?:\d+|[０-９]+|[〇零一二三四五六七八九十百千万億]+)\s*(?:件|人)(?:あたり|につき|ごと)?|(?:申込|申し込|成約|獲得|承認|契約|発生|決ま(?:る|り))[^。\n]{0,12}(?:ごと|たび|ベース)/;

// 4. ASP報酬額（内部管理値。読者向けページに載せてはならない）
const ASP_REWARD_PATTERNS = [
  { re: /報酬|単価|コミッション|紹介料|成約|(?:^|[^A-Za-z])CV(?:[^A-Za-z]|$)|(?:^|[^A-Za-z])CPA(?:[^A-Za-z]|$)|(?:^|[^A-Za-z])EPC(?:[^A-Za-z]|$)|アフィリエイト収益/i, label: '内部案件経済語' },
  { re: /成果報酬|報酬単価|承認報酬|案件単価|高単価/, label: '内部報酬・案件単価の概念' },
  { re: /1件(?:成約|獲得|申込|承認)[^。\n]{0,24}?(?:収益|報酬|利益)|(?:収益|報酬|利益)[^。\n]{0,24}?1件(?:成約|獲得|申込|承認)/, label: '1件成約あたりの収益概念' },
  { re: /\d[\d,，]*\s*円\s*[/／]\s*件/, label: '「◯円/件」形式の報酬額' },
  { re: /[〇零一二三四五六七八九十百千万億壱弐参肆伍陸漆捌玖拾佰仟萬]+\s*円\s*[/／]\s*件/, label: '漢数字の「◯円/件」形式の報酬額' },
  { re: /(?:成果報酬|報酬単価|アフィリエイト報酬|承認報酬)[^。\n]{0,20}?(?:\d[\d,]*(?:\.\d+)?\s*(?:万|千)?|[〇零一二三四五六七八九十百千万億壱弐参肆伍陸漆捌玖拾佰仟萬]+)\s*円/, label: '報酬語＋金額' },
  { re: /1件(?:あたり|につき)[^。\n]{0,8}?\d[\d,，]*\s*円/, label: '「1件あたり◯円」形式の報酬額' },
  { re: /(?:この|当該|ASP|アフィリエイト)?案件[^。\n]{0,24}?高単価|高単価[^。\n]{0,24}?(?:案件|報酬|プログラム)/, label: '案件の高単価訴求' },
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

// D-27: マークダウン表は「列見出しにJFX・セル側にはJFXの語なし」という形になるため、
// 行単位（＝文単位）の検査では列とセルが結び付かず、JFX列に誤った可否が入っても検知できない。
// 実例: fxtf-review の「| MetaTrader対応 | ✅ あり | ✅ あり |」は行にJFXが無いため
// BROKER-F02・F05の2回の掃討をすり抜けた。ヘッダ行からJFX列を特定し、
// 行見出し＋当該セルを1セグメントへ復元してJFX文脈の検査へ載せる。
// （JFXが行見出し側にある表は行内にJFXが出るため、既存の文単位検査で拾える）
const MARKDOWN_DIVIDER_RE = /^\s*\|[\s:|-]+\|\s*$/;
// セルが可否を条件付きで明示している場合、行見出しの「MetaTrader対応」は列ラベルであって
// 主張ではない。結合すると統一表現どおりの正しい表記が JFX_MT4_CAPABLE_RE で落ちるため切り離す。
const TABLE_CELL_QUALIFIED_RE = /分析専用|不可|できない|できません|非対応|未提供|実装されていない|提供終了/i;

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    // 「[MT4](/blog/...)対応」のリンク記法はMT4と対応の連結を断ち切り検知漏れになるため、
    // アンカーテキストだけに落としてから判定する。
    .map((cell) => cell.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim());
}

function extractJfxTableSegments(content) {
  const segments = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*\|/.test(lines[index])) continue;
    if (!MARKDOWN_DIVIDER_RE.test(lines[index + 1] ?? '')) continue;
    const headerCells = splitMarkdownRow(lines[index]);
    const jfxColumns = headerCells
      .map((cell, column) => (JFX_CONTEXT_RE.test(cell) ? column : -1))
      .filter((column) => column > 0);
    let row = index + 2;
    for (; row < lines.length && /^\s*\|/.test(lines[row]); row += 1) {
      if (jfxColumns.length === 0) continue;
      const cells = splitMarkdownRow(lines[row]);
      const rowHead = cells[0] ?? '';
      for (const column of jfxColumns) {
        const cell = cells[column];
        if (!cell) continue;
        const head = TABLE_CELL_QUALIFIED_RE.test(cell) ? '' : rowHead;
        segments.push(`JFX ${head} ${cell}`.replace(/\s+/g, ' ').trim());
      }
    }
    index = row - 1;
  }
  return segments;
}

function extractStructuredSafetySegments(content) {
  const segments = extractJfxTableSegments(content);
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const frontmatterLines = frontmatter.split('\n');
  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    if (/^(title|description):\s*/.test(line)) segments.push(line);
    if (!/^tags:\s*/.test(line)) continue;
    const tagLines = [line];
    while (
      index + 1 < frontmatterLines.length
      && !/^[A-Za-z_][\w-]*:\s*/.test(frontmatterLines[index + 1])
    ) {
      tagLines.push(frontmatterLines[index + 1]);
      index += 1;
    }
    segments.push(tagLines.join('\n'));
  }
  for (const component of content.matchAll(CTA_COMPONENT_RE)) {
    for (const match of component[0].matchAll(CTA_ATTR_RE)) {
      segments.push(`${match[1]}=${match[2] ?? match[3] ?? ''}`);
    }
  }
  for (const component of content.matchAll(COMPONENT_RE)) {
    if (component[1] !== 'ComparisonTable') continue;
    // 表全体を1文にすると、列見出しのJFXと別行のFXTF仕様が誤結合するため行単位で検査する。
    for (const row of component[0].matchAll(/\{([^{}]+)\}/g)) {
      segments.push(row[1]);
    }
  }
  return segments;
}

function checkInjectionSafetyInternal(content, includeStructuredSegments) {
  const errors = [];
  // frontmatter・CTA属性・比較表はHTML/MDX除去前に取り出し、可視面の抜け道を塞ぐ。
  const sentences = [...new Set([
    ...(includeStructuredSegments ? extractStructuredSafetySegments(content) : []),
    ...splitSentences(content),
  ])];

  for (const s of sentences) {
    // 1. scope外語句は原則拒否。明示的な否定・注意喚起だけ許可
    for (const { re, label } of SCOPE_TERMS) {
      if (!re.test(s)) continue;
      if (!hasOnlyAllowedScopeMentions(s)) {
        errors.push(`scope外語句「${label}」は明示的な否定・注意喚起以外では扱わない: 「${s.slice(0, 60)}」`);
      }
      break;
    }

    // 2. JFX不変条件（MT4はチャート分析専用）
    const jfxMatch = s.match(JFX_CONTEXT_RE);
    if (jfxMatch) {
      // MT4の禁止操作と、正しいMATRIX TRADER発注を主体別に分離する。
      const jfxContext = maskMatrixTraderOrders(s.slice((jfxMatch.index ?? 0)));
      if (hasAffirmativeMt4Operation(jfxContext) || JFX_MT4_CAPABLE_RE.test(jfxContext)) {
        errors.push(`JFX不変条件違反（MT4は分析専用・発注/EA不可が正）: 「${compactSnippet(jfxContext).slice(0, 60)}」`);
      } else if (JFX_EA_CAPABLE_RE.test(jfxContext)) {
        errors.push(`JFX不変条件違反（EA・自動売買は不可が正）: 「${compactSnippet(jfxContext).slice(0, 60)}」`);
      }
    }

    // 3. ASP内部経済は「紹介」等が社会的証明にも見えるため、理由分類を先に確定する。
    if (
      INTERNAL_DEAL_RE.test(s)
      && INTERNAL_PAYOUT_EVENT_RE.test(s)
      && INTERNAL_MONEY_RE.test(s)
    ) {
      errors.push(`ASP報酬額の露出（案件の金銭取得イベント・内部管理値は本文に書かない）: 「${s.slice(0, 60)}」`);
    }
    if (
      INTERNAL_ECONOMICS_CONTEXT_RE.test(s)
      && INTERNAL_UNIT_EVENT_RE.test(s)
      && (INTERNAL_MONEY_RE.test(s) || INTERNAL_PAYOUT_EVENT_RE.test(s))
    ) {
      errors.push(`ASP報酬額の露出（広告・申込等の単位イベントと金銭情報は本文に書かない）: 「${s.slice(0, 60)}」`);
    }

    // 4. ASP報酬額
    const normalizedForReward = s.normalize('NFKC');
    for (const { re, label } of ASP_REWARD_PATTERNS) {
      if (re.test(normalizedForReward)) {
        errors.push(`ASP報酬額の露出（${label}・内部管理値は本文に書かない）: 「${s.slice(0, 60)}」`);
      }
    }

    // 5. 未証明の一人称利用体験・第三者成果
    for (const { re, label } of UNPROVEN_EXPERIENCE_PATTERNS) {
      if (re.test(s)) {
        errors.push(`未証明の利用体験・成果表現（${label}）: 「${s.slice(0, 60)}」`);
      }
    }
    if (
      THIRD_PARTY_SUBJECT_RE.test(s)
      && THIRD_PARTY_RESULT_RE.test(s)
      && THIRD_PARTY_HEARSAY_RE.test(s)
    ) {
      errors.push(`未証明の利用体験・成果表現（第三者成果の伝聞）: 「${s.slice(0, 60)}」`);
    }
    if (
      SOCIAL_PROOF_RE.test(s)
      && (SOCIAL_RESULT_RE.test(s) || SOCIAL_NUMBER_RE.test(s))
    ) {
      errors.push(`未証明の利用体験・成果表現（社会的証明と成果・数値の共起）: 「${s.slice(0, 60)}」`);
    }
  }
  return errors;
}

// 生成再注入チェック本体。拒否理由の配列を返す（空=通過）
export function checkInjectionSafety(content) {
  return checkInjectionSafetyInternal(content, true);
}

// ── published全件の構造化scope監査（P0-C13R 2026-07-25）────────
// 生成物は上の原則REJECTを通す。既存published記事だけは、MDX構造を保持したまま
// 積極誘導と正当な注意喚起・商品仕様・税務・出典を分離して監査する。
const LEGACY_SCOPE_SLUGS = new Set([
  'fx-auto-trade-shoshinsha',
  'fxtf-cfd-hajimekata',
  'fxtf-knockout-option',
]);
const CTA_COMPONENT_RE = /<(?:[A-Z][A-Za-z0-9]*CTA)\b[\s\S]*?\/>/g;
const COMPONENT_RE = /<([A-Z][A-Za-z0-9]*)\b[\s\S]*?\/>/g;
const CTA_ATTR_RE = /\b(heading|lead|note|badge|text)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const WARNING_SCOPE_RE = /向いていない|向かない|できない|できません|できず|使えない|不可|非対応|扱わない|扱いません|扱わず|扱っていない|紹介しない|紹介しません|推奨しない|推奨しません|推奨せず|対象外|答えられない|実現できない|にはない|わけではない|税|課税|確定申告|損益通算|リスク|注意|危険|怖い|出金拒否|デメリット|罠|元本(?:が)?保証されず|元本保証(?:がなく|[^。\n]*ない|はありません)|価値(?:が|は)ゼロ|無登録|詐欺|トラブル|避ける|手を出さない/i;
const NEGATIVE_AUDIENCE_RE = /向いていない人|向かない人|できない人|対象外(?:の人|商品)?/i;
const NEUTRAL_SECTION_RE = /スペック|仕様|基本情報|取引条件|対応状況|機能比較|商品比較|ツール|利用料|コスト|手数料|税|課税|確定申告|出典|参考|参照|公式情報|一次情報/i;
const NEUTRAL_FACT_RE = /とは|仕組み|提供|リリース|発表|設立|会社|サーバー|プラン|ドキュメント|対応(?:している|状況|可否|も変わる)|取引(?:が)?できる|利用(?:が)?できる|スプレッド|手数料|費用|税|課税|確定申告|損益通算|出典|参考|参照|公式|金融庁|国税庁|登録業者|違い|違法(?:なの|か)/i;

function scopeTermFor(text) {
  return SCOPE_TERMS.find(({ re }) => re.test(text));
}

function compactSnippet(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 100);
}

function extractLiteralCtaAttributes(component) {
  const values = [];
  for (const match of component.matchAll(CTA_ATTR_RE)) {
    values.push(`${match[1]}=${match[2] ?? match[3] ?? ''}`);
  }
  return values.join(' ');
}

function extractMarkdownBlocks(content) {
  const withoutComponents = content
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/^import .+$/gm, '')
    .replace(COMPONENT_RE, '')
    .replace(/<[^>]+>/g, '');
  const blocks = [];
  let heading = '';
  let lines = [];

  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) blocks.push({ heading, text });
    lines = [];
  };

  for (const line of withoutComponents.split('\n')) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flush();
      heading = headingMatch[1].trim();
    } else if (!line.trim()) {
      flush();
    } else {
      lines.push(line);
    }
  }
  flush();
  return blocks;
}

function findLegacyPromotionLinks(content) {
  const errors = [];
  const legacySlugs = [...LEGACY_SCOPE_SLUGS].join('|');
  const markdownLinkRe = new RegExp(
    `\\[[^\\]]*\\]\\((?:https?://(?:www\\.)?tsumiba\\.com)?/blog/(${legacySlugs})/?(?:[?#][^\\s)]*)?\\)`,
    'g',
  );
  const htmlLinkRe = new RegExp(
    `\\bhref\\s*=\\s*["'](?:https?://(?:www\\.)?tsumiba\\.com)?/blog/(${legacySlugs})/?(?:[?#][^"']*)?["']`,
    'g',
  );

  for (const link of content.matchAll(markdownLinkRe)) {
    errors.push(`legacy記事「${link[1]}」へのMarkdownリンク: 「${compactSnippet(link[0])}」`);
  }
  for (const link of content.matchAll(htmlLinkRe)) {
    errors.push(`legacy記事「${link[1]}」へのHTMLリンク: 「${compactSnippet(link[0])}」`);
  }
  return errors;
}

export function checkPublishedScopeSafety(content, slug) {
  const activeErrors = [];
  const exemptWarning = [];
  const exemptNeutral = [];
  const legacyExempt = [];
  const publishedSentences = splitSentences(content);
  const hasPublicRewardDisclosure = publishedSentences.some(sentence => (
    ASP_REWARD_PATTERNS.some(({ re }) => re.test(sentence.normalize('NFKC')))
    && /MLM|マルチ商法|勧誘|詐欺|税|雑所得|確定申告|ライティング/.test(sentence)
  ));
  const hasNeutralExternalEvidence = publishedSentences.some(sentence => (
    SOCIAL_PROOF_RE.test(sentence)
    && (SOCIAL_RESULT_RE.test(sentence) || SOCIAL_NUMBER_RE.test(sentence))
    && /教育コンテンツ|公的|公式|調査|統計|目安/.test(sentence)
  ));

  for (const error of checkInjectionSafety(content).filter(item => !item.startsWith('scope外語句'))) {
    const isPublishedSocialWarning = error.startsWith('未証明の利用体験・成果表現')
      && (
        /保証するものではありません|生存者バイアス|投稿してしまう|とすれば[^」]*投稿/.test(error)
        || (
          error.includes('社会的証明と成果・数値の共起')
          && /評価/.test(error)
          && !/(口コミ|投稿|声|レビュー|体験談|アンケート|コメント|回答|感想)/.test(error)
        )
      );
    if (error.startsWith('ASP報酬額の露出') && hasPublicRewardDisclosure) {
      exemptNeutral.push(`税務・詐欺注意に必要な報酬語: ${error}`);
    } else if (error.includes('社会的証明と成果・数値の共起') && hasNeutralExternalEvidence) {
      exemptNeutral.push(`外部根拠・目安の中立記述: ${error}`);
    } else if (isPublishedSocialWarning) {
      exemptNeutral.push(`注意喚起・成果保証否定・商品編集評価: ${error}`);
    } else {
      activeErrors.push(error);
    }
  }

  if (LEGACY_SCOPE_SLUGS.has(slug)) {
    // legacy件数は従来と比較できる本文基準。生成ゲート自体は構造面も検査する。
    const strictScopeErrors = checkInjectionSafetyInternal(content, false)
      .filter(error => error.startsWith('scope外語句'));
    legacyExempt.push(...strictScopeErrors.map(error => `LEGACY_EXEMPT: ${error}`));
    return { activeErrors, exemptWarning, exemptNeutral, legacyExempt };
  }

  activeErrors.push(...findLegacyPromotionLinks(content));

  // HTML/MDXタグを消す前にCTAの読者向け属性を検査する。
  for (const componentMatch of content.matchAll(CTA_COMPONENT_RE)) {
    const attributes = extractLiteralCtaAttributes(componentMatch[0]);
    const scope = scopeTermFor(attributes);
    if (!scope) continue;
    const strictScopeErrors = checkInjectionSafety(componentMatch[0])
      .filter(error => error.startsWith('scope外語句'));
    if (strictScopeErrors.length === 0) continue;
    activeErrors.push(`CTA内のscope外誘導（${scope.label}）: 「${compactSnippet(attributes)}」`);
  }

  // ComparisonTableのhighlight行は、scope外語句との共存を積極誘導として扱う。
  for (const componentMatch of content.matchAll(COMPONENT_RE)) {
    if (componentMatch[1] !== 'ComparisonTable') continue;
    for (const row of componentMatch[0].matchAll(/\{([^{}]*\bhighlight\s*:\s*["']([^"']+)["'][^{}]*)\}/g)) {
      if (!row[2] || row[2].toLowerCase() === 'false') continue;
      const scope = scopeTermFor(row[1]);
      if (scope) {
        activeErrors.push(`ComparisonTable highlightのscope外誘導（${scope.label}）: 「${compactSnippet(row[1])}」`);
      }
    }
  }

  const blocks = extractMarkdownBlocks(content);
  for (const [index, block] of blocks.entries()) {
    const isMarkdownTable = block.text.split('\n').filter(Boolean).every(line => /^\s*\|/.test(line));
    let sourceText = block.text;
    const sourceLines = sourceText.split('\n').filter(Boolean);
    const blockLead = sourceLines[0] ?? '';
    const blockRemainder = sourceLines.slice(1).join('\n');
    const nextText = blocks[index + 1]?.text ?? '';
    const isScopeDecisionLabel = /^\s*\*\*[\s\S]*\*\*\s*$/.test(blockLead) && scopeTermFor(blockLead);
    const hasInlineDecisionRejection = isScopeDecisionLabel && WARNING_SCOPE_RE.test(blockRemainder);
    const hasNextDecisionRejection = isScopeDecisionLabel
      && !blockRemainder
      && WARNING_SCOPE_RE.test(nextText);
    if (hasNextDecisionRejection) {
      sourceText = `${sourceText}\n${nextText}`;
    }
    const isQuotedClaim = /^[「『]/.test(sourceText.trim())
      && /宣伝|広告|うたい文句|注意|リスク|罠/.test(nextText);
    if (isQuotedClaim) sourceText = `${sourceText}\n${nextText}`;

    const isPairedWarning = hasInlineDecisionRejection || hasNextDecisionRejection || isQuotedClaim;
    const units = isMarkdownTable
      ? sourceText.split('\n').filter(line => /^\s*\|/.test(line) && scopeTermFor(line))
      : isPairedWarning
        ? [sourceText]
      : sourceText.split(/[。\n]/).map(text => text.trim()).filter(text => scopeTermFor(text));

    for (const unit of units) {
      const scope = scopeTermFor(unit);
      if (!scope) continue;
      const strictScopeErrors = checkInjectionSafety(unit)
        .filter(error => error.startsWith('scope外語句'));
      if (strictScopeErrors.length === 0) continue;
      const context = `${block.heading}\n${blockLead}\n${unit}`;
      const hasWarning = WARNING_SCOPE_RE.test(context);
      const isNegativeAudience = NEGATIVE_AUDIENCE_RE.test(block.heading)
        || NEGATIVE_AUDIENCE_RE.test(unit.split('\n', 1)[0]);
      const isWarningSection = WARNING_SCOPE_RE.test(block.heading)
        || WARNING_SCOPE_RE.test(blockLead);
      const hasScopeWarningContinuation = unit
        .split(/[、,]/)
        .map(clause => clause.replace(/\]\([^)]*\)/g, ']'))
        .some(clause => scopeTermFor(clause) && SCOPE_WARNING_CONTINUATION_RE.test(clause));
      const hasNeutralStructure = (
        isMarkdownTable
        || NEUTRAL_SECTION_RE.test(block.heading)
        || NEUTRAL_FACT_RE.test(unit)
      );

      if (
        isNegativeAudience
        || isPairedWarning
        || hasScopeWarningContinuation
        || (isWarningSection && hasWarning)
      ) {
        exemptWarning.push(`明示的な対象外・否定（${scope.label}）: 「${compactSnippet(unit)}」`);
      } else if (hasNeutralStructure) {
        exemptNeutral.push(`商品仕様・税務・出典の中立記述（${scope.label}）: 「${compactSnippet(unit)}」`);
      } else {
        activeErrors.push(`分類不能なscope外記述（${scope.label}）: 「${compactSnippet(unit)}」`);
      }
    }
  }

  return { activeErrors, exemptWarning, exemptNeutral, legacyExempt };
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

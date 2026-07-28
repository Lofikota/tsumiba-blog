#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInjectionSafety, checkPublishedScopeSafety } from './quality-gate.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// P0-C11の正規7ケースと、P0-C12Bで固定するscope言い換え・否定の回帰fixture。
const CASES = [
  { group: 'canonical', expected: 'ALLOW', text: 'JFXのMT4は分析専用、発注・EA自動売買は不可' },
  { group: 'canonical', expected: 'REJECT', text: 'JFXはEA運用に向いている' },
  { group: 'canonical', expected: 'REJECT', text: 'JFXのMT4ではEAを動かせる' },
  { group: 'canonical', expected: 'REJECT', text: 'JFXのMT4で自動売買できる' },
  { group: 'canonical', expected: 'REJECT', text: '編集部が口座を開設して使った' },
  { group: 'canonical', expected: 'REJECT', text: '読者のAさんは口座開設後3か月で利益を出した' },
  { group: 'canonical', expected: 'REJECT', text: '成果報酬は33,000円/件' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDが強みです' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDで使い分けられます' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDにはメリットがあります' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDも選択肢です' },
  { group: 'variant', expected: 'REJECT', text: 'FXTFのCFDに挑戦したい人' },
  { group: 'variant', expected: 'REJECT', text: 'CFDは推奨対象外ですが、FXTFのCFDが強みです' },
  { group: 'variant', expected: 'REJECT', text: 'CFDにはメリットがありますが、リスクもあります' },
  { group: 'variant', expected: 'REJECT', text: 'CFDはリスクが高いですが、選択肢です' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDは推奨対象外で、リスクが高いため紹介しません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDのデメリットとリスクを説明します' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDにはメリットがありません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDを強みとは評価していません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDも選択肢に含めません' },
  { group: 'safe', expected: 'ALLOW', text: 'CFDで使い分けることは推奨しません' },
  { group: 'safe', expected: 'REJECT', text: 'CFDに挑戦したい人にも、当サイトでは紹介しません' },
  { group: 'safe', expected: 'ALLOW', text: '海外FXの危険性と注意点を説明します' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: '日経225や金を取引したいなら、FXTFのCFDという手がある' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: 'CFDも視野に入れたい人はFXTFが候補になる' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: 'EA運用に踏み出すならMT4対応口座が必要になる' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: '海外FXのほうが有利なケースもある' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: 'FXスクールで学ぶのも一つの道だ' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: 'CFDまで手を伸ばせるのはFXTFならでは' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: '自動売買に興味があるならFXTFを一度見ておくとよい' },
  { group: 'p0-c13r-variant', expected: 'REJECT', text: 'ノックアウトオプションは損失を限定できるので初心者にも扱いやすい' },
  { group: 'p0-c13r-safe', expected: 'ALLOW', text: '海外FXは無登録業者が多く、当サイトでは扱いません' },
  { group: 'p0-c13r-safe', expected: 'ALLOW', text: 'JFXのMT4はチャート分析専用で、発注・EA自動売買はできません' },
  { group: 'p0-c13r-safe', expected: 'ALLOW', text: 'CFDは対象外のため紹介しません' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: 'CFDで大きな利益を狙えます、リスク管理も重要です' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: '---\ntitle: "CFDも選択肢"\ndescription: "国内FX比較"\ntags: ["FX"]\n---\n本文' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: '---\ntitle: "国内FX比較"\ndescription: "口座の選び方"\ntags:\n  - FX\n  - 海外FX\n---\n本文' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: '<AffiliateCTA text="CFDを始める" />' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: '<AffiliateCTA badge="EA対応" />' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: '<AffiliateCTA note="自動売買を試したい人向け" />' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: '<AffiliateCTA lead="CFDも候補に含める" />' },
  { group: 'p0-c13r-structure', expected: 'REJECT', text: '<ComparisonTable rows={[{ item: "CFD", value: "取引候補", highlight: "fxtf" }]} />' },
  { group: 'p0-c13r-adversarial', expected: 'REJECT', text: 'リスクを理解すればCFDは初心者にもおすすめです' },
  { group: 'p0-c13r-adversarial', expected: 'REJECT', text: 'CFDはリスク管理しながら始める価値があります' },
  { group: 'p0-c13r-adversarial', expected: 'REJECT', text: '成果報酬は三万三千円/件' },
  { group: 'p0-c13r-adversarial', expected: 'REJECT', text: 'この案件は高単価なのでおすすめです' },
  { group: 'p0-c13r-adversarial', expected: 'REJECT', text: '利用者から利益が出たとの声が届きました' },
  { group: 'p0-c13r-active-sync', expected: 'REJECT', text: 'リスクを理解したうえでCFDを始めたい人' },
  { group: 'p0-c13r-active-sync', expected: 'REJECT', text: 'CFDはリスクを理解して利益を狙う手段です' },
  { group: 'p0-c13r-active-sync', expected: 'REJECT', text: '注意点を確認してCFDを取引したい人' },
  { group: 'p0-c13r-active-sync', expected: 'REJECT', text: 'CFDのリスクについて学んでから活用したい' },
  { group: 'p0-c13r-reward', expected: 'REJECT', text: '報酬単価は3万円です' },
  { group: 'p0-c13r-reward', expected: 'REJECT', text: '成果報酬は三万三千円です' },
  { group: 'p0-c13r-reward', expected: 'REJECT', text: '成果報酬は３３，０００円/件' },
  { group: 'p0-c13r-jfx', expected: 'REJECT', text: 'JFXのMT4は分析専用ですが発注できます' },
  { group: 'p0-c13r-jfx', expected: 'REJECT', text: 'JFXのMT4は分析専用ではなく発注できます' },
  { group: 'p0-c13r-jfx', expected: 'REJECT', text: 'JFXのMT4では発注でき、チャート分析専用です' },
  { group: 'p0-c13r-jfx', expected: 'REJECT', text: 'JFXのMT4は発注できますがEAは利用できません' },
  { group: 'p0-c13r-jfx', expected: 'ALLOW', text: 'JFXのMT4はチャート分析専用で、発注はMATRIX TRADERから行います' },
  // BROKER-F02: MT4は2026-08-19に提供終了しMT5へ移行。分析専用の位置づけはMT5でも同じなので
  // バージョン名を替えただけの誤情報がゲートをすり抜けないことを検査する。
  { group: 'broker-f02-mt5', expected: 'REJECT', text: 'JFXのMT5では発注できます' },
  { group: 'broker-f02-mt5', expected: 'REJECT', text: 'JFXのMT5ではEAを動かせる' },
  { group: 'broker-f02-mt5', expected: 'REJECT', text: 'JFXのMT5で自動売買できる' },
  { group: 'broker-f02-mt5', expected: 'REJECT', text: 'JFXのMT5から新規ポジションを建てられます' },
  { group: 'broker-f02-mt5', expected: 'ALLOW', text: 'JFXのMT5チャートは分析専用で、発注はMATRIX TRADERから行います' },
  { group: 'broker-f02-mt5', expected: 'ALLOW', text: 'JFXは2026年8月19日にMT4の提供を終了しMT5へ移行します' },
  { group: 'p0-c13r-whitelist', expected: 'REJECT', text: '注意点を押さえれば海外FXも選んでよい' },
  { group: 'p0-c13r-whitelist', expected: 'REJECT', text: 'CFDのリスクを理解して取引を始めましょう' },
  { group: 'p0-c13r-whitelist', expected: 'REJECT', text: 'ノックアウトオプションはリスクを確認したうえで申し込めます' },
  { group: 'p0-c13r-reward-concept', expected: 'REJECT', text: '案件単価が良い広告です' },
  { group: 'p0-c13r-reward-concept', expected: 'REJECT', text: '1件成約するたびに収益が増えます' },
  { group: 'p0-c13r-third-party', expected: 'REJECT', text: '好評の口コミとして、利益が出たとお客様から報告されました' },
  { group: 'p0-c13r-jfx-actor', expected: 'REJECT', text: 'JFXのMT4から注文を出せます' },
  { group: 'p0-c13r-jfx-actor', expected: 'REJECT', text: 'JFXのMT4を使ってエントリー可能です' },
  { group: 'p0-c13r-reward-concept-2', expected: 'REJECT', text: '提携プログラムのコミッションは一成約あたり￥25,000です' },
  { group: 'p0-c13r-reward-concept-2', expected: 'REJECT', text: '紹介料は成約ごとに三万円です' },
  { group: 'p0-c13r-reward-concept-2', expected: 'REJECT', text: 'CV単価が高い案件です' },
  { group: 'p0-c13r-jfx-actor-2', expected: 'REJECT', text: 'JFXのMT4から新規ポジションを建てられます' },
  { group: 'p0-c13r-jfx-actor-2', expected: 'REJECT', text: 'JFXのMT4で決済します' },
  { group: 'p0-c13r-jfx-actor-2', expected: 'REJECT', text: 'JFXではMATRIX TRADERではなくMT4上で注文します' },
  { group: 'p0-c13r-social-proof', expected: 'REJECT', text: '成功者の声では月5万円増えたと紹介されています' },
  { group: 'p0-c13r-social-proof', expected: 'REJECT', text: '口座利用者アンケートで稼げたという回答がありました' },
  { group: 'p0-c13r-social-proof', expected: 'REJECT', text: '体験者コメントで利益が出たというレビューです' },
  { group: 'p0-c13r-published-boundary', expected: 'REJECT', text: 'MLMでは友達紹介の報酬を強調する勧誘に注意が必要です' },
  { group: 'p0-c13r-published-boundary', expected: 'REJECT', text: '確定申告ではライティング報酬を雑所得として区分します' },
  { group: 'p0-c13r-published-boundary', expected: 'REJECT', text: '教育コンテンツでは初心者の目安を3〜5倍として紹介しています' },
  { group: 'p0-c13r-internal-economics-3', expected: 'REJECT', text: '発生ベースで25,000円を受け取れる案件です' },
  { group: 'p0-c13r-internal-economics-3', expected: 'REJECT', text: '広告案件で一件決まるたびに二万円が入ります' },
  { group: 'p0-c13r-jfx-position-3', expected: 'REJECT', text: 'JFXのMT4からポジションを閉じられます' },
  { group: 'p0-c13r-jfx-position-3', expected: 'REJECT', text: 'JFXのMT4で建玉を保有できます' },
  { group: 'p0-c13r-jfx-position-3', expected: 'REJECT', text: 'JFXのMT4上で保有ポジションを手仕舞いできます' },
  { group: 'p0-c13r-social-proof-3', expected: 'REJECT', text: 'トレーダーから収益が増えたとの感想が届いています' },
  { group: 'p0-c13r-internal-economics-4', expected: 'REJECT', text: '広告リンク経由の申込み1件につき二万円が支払われます' },
  { group: 'p0-c13r-jfx-position-4', expected: 'REJECT', text: 'JFXのMT4から保有玉をクローズ可能です' },
  { group: 'p0-c13r-social-proof-4', expected: 'REJECT', text: '現役トレーダーの口コミに「半年で黒字化した」とあります' },
  { group: 'p0-c13r-jfx-position-5', expected: 'REJECT', text: 'JFXのMT4画面で建玉を解消できます' },
  { group: 'p0-c13r-jfx-position-5', expected: 'ALLOW', text: 'JFXのMT4画面で建玉を解消できません' },
  { group: 'p0-c13r-social-proof-5', expected: 'REJECT', text: 'ユーザー評価では年間収支が黒字になったという投稿があります' },
  {
    group: 'p0-c13r-reason-priority',
    expected: 'REJECT',
    expectedReason: 'ASP報酬額',
    text: '紹介リンクから一人申し込むごとに15,000円が振り込まれます',
  },
];

const PUBLISHED_LINK_CASES = [
  {
    slug: 'normal-article',
    expected: 'REJECT',
    text: '[詳しくはこちら](/blog/fx-auto-trade-shoshinsha/)',
  },
  {
    slug: 'normal-article',
    expected: 'REJECT',
    text: '[FXTF](/blog/fxtf-knockout-option/)',
  },
  {
    slug: 'normal-article',
    expected: 'REJECT',
    text: '<a href="/blog/fxtf-cfd-hajimekata/">旧記事を見る</a>',
  },
  {
    slug: 'fx-auto-trade-shoshinsha',
    expected: 'ALLOW',
    text: '[記事内リンク](/blog/fxtf-knockout-option/)',
  },
  {
    slug: 'normal-article',
    expected: 'REJECT',
    text: '<AffiliateCTA text="リスクを理解したうえでCFDを始めたい人へ" />',
  },
  {
    slug: 'normal-article',
    expected: 'REJECT',
    text: '<AffiliateCTA text="注意点を押さえれば海外FXも選んでよい" />',
  },
  {
    slug: 'normal-article',
    expected: 'REJECT',
    text: '<AffiliateCTA text="CFDのリスクを理解して取引を始めましょう" />',
  },
  {
    slug: 'normal-article',
    expected: 'REJECT',
    text: '<AffiliateCTA text="リスク確認後にノックアウトオプションへ申し込む" />',
  },
  {
    slug: 'published-scam-warning',
    expected: 'ALLOW',
    text: 'MLMでは友達紹介の報酬を強調する勧誘に注意が必要です。',
  },
  {
    slug: 'published-tax-guide',
    expected: 'ALLOW',
    text: '確定申告ではライティング報酬を雑所得として区分します。',
  },
  {
    slug: 'published-external-evidence',
    expected: 'ALLOW',
    text: '教育コンテンツでは初心者の目安を3〜5倍として紹介しています。',
  },
  {
    slug: 'published-result-disclaimer',
    expected: 'ALLOW',
    text: '過去の顧客満足度の評価は将来の取引成果を保証するものではありません。',
  },
  {
    slug: 'published-editorial-evaluation',
    expected: 'ALLOW',
    text: 'OANDAはこの点ではプラスに評価できる。',
  },
];

function actualForArticle(text) {
  const errors = checkInjectionSafety(text);
  return {
    decision: errors.length > 0 ? 'REJECT' : 'ALLOW',
    reason: errors[0] ?? null,
  };
}

function reasonMatches(reason, expectedReason) {
  if (!expectedReason) return true;
  if (expectedReason === 'ASP報酬額') {
    return /^ASP.*報酬額/.test(reason ?? '');
  }
  return reason?.includes(expectedReason) ?? false;
}

const python = String.raw`
import importlib.util
import json
import sys

module_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("generate_tweets_scope_test", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = json.load(sys.stdin)
results = []
for case in cases:
    reason = module.unsafe_content_reason(case["text"])
    results.append({
        "decision": "REJECT" if reason else "ALLOW",
        "reason": reason,
    })
print(json.dumps(results, ensure_ascii=False))
`;
const pythonResult = spawnSync(
  'python3',
  ['-c', python, path.join(ROOT, 'x-automation/generate_tweets.py')],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      PYTHONPATH: [path.join(ROOT, 'x-automation'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    },
    input: JSON.stringify(CASES),
    encoding: 'utf8',
  },
);
if (pythonResult.status !== 0) {
  process.stderr.write(pythonResult.stderr);
  process.exit(pythonResult.status ?? 1);
}

const xActuals = JSON.parse(pythonResult.stdout);
let failed = 0;
for (const [index, testCase] of CASES.entries()) {
  const articleResult = actualForArticle(testCase.text);
  const xResult = xActuals[index];
  const reasonOk = !testCase.expectedReason || (
    reasonMatches(articleResult.reason, testCase.expectedReason)
    && reasonMatches(xResult.reason, testCase.expectedReason)
  );
  const ok = articleResult.decision === testCase.expected
    && xResult.decision === testCase.expected
    && reasonOk;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'OK' : 'NG'} [${testCase.group}] expected=${testCase.expected} `
    + `article=${articleResult.decision} x=${xResult.decision}`
    + `${testCase.expectedReason ? ` reason=${testCase.expectedReason}:${reasonOk ? 'OK' : 'NG'}` : ''}`
    + ` | ${testCase.text}`,
  );
}

for (const testCase of PUBLISHED_LINK_CASES) {
  const result = checkPublishedScopeSafety(testCase.text, testCase.slug);
  const actual = result.activeErrors.length > 0 ? 'REJECT' : 'ALLOW';
  const ok = actual === testCase.expected;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'OK' : 'NG'} [published-link] expected=${testCase.expected} `
    + `actual=${actual} slug=${testCase.slug} | ${testCase.text}`,
  );
}

const canonical = CASES.filter(testCase => testCase.group === 'canonical');
const caseFailures = failed;
const blogDir = path.join(ROOT, 'src/content/blog');
const publishedFiles = fs.readdirSync(blogDir)
  .filter(file => file.endsWith('.mdx'))
  .sort()
  .filter(file => {
    const content = fs.readFileSync(path.join(blogDir, file), 'utf8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    return !/^draft:\s*true\s*$/m.test(frontmatter);
  });

let publishedErrors = 0;
let flaggedArticles = 0;
let exemptWarning = 0;
let exemptNeutral = 0;
let legacyExempt = 0;
for (const file of publishedFiles) {
  const content = fs.readFileSync(path.join(blogDir, file), 'utf8');
  const slug = file.replace(/\.mdx$/, '');
  const result = checkPublishedScopeSafety(content, slug);
  exemptWarning += result.exemptWarning.length;
  exemptNeutral += result.exemptNeutral.length;
  legacyExempt += result.legacyExempt.length;
  if (result.activeErrors.length > 0) {
    flaggedArticles += 1;
    publishedErrors += result.activeErrors.length;
    console.log(
      `NG [published] ${file} active=${result.activeErrors.length} | ${result.activeErrors[0]}`,
    );
  }
}

failed += publishedErrors;
console.log(
  `PUBLISHED=${publishedFiles.length} FLAGGED_ARTICLES=${flaggedArticles} ACTIVE_ERRORS=${publishedErrors} `
  + `EXEMPT_WARNING=${exemptWarning} EXEMPT_NEUTRAL=${exemptNeutral} LEGACY_EXEMPT=${legacyExempt}`,
);
console.log(`SUMMARY total=${CASES.length - caseFailures}/${CASES.length} canonical=${canonical.length}/7 failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);

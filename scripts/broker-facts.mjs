/**
 * 生成プロンプトへ渡す「業者事実ブロック」を組み立てる。DOCTRINE-D02-b。
 *
 * 事実の正本は AI運用/データ正本/brokers_*.yaml。ここが読むのはその派生物
 * data/broker-facts.json（生成: node scripts/sync-broker-facts.mjs）。プロンプト本文に業者の
 * 条件・数値を書かず、必ずこのブロック経由で渡す。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FACTS_PATH = path.join(ROOT, 'data/broker-facts.json');
const AFFILIATE_ROOT = path.join(ROOT, '..');

export const USAGE_RULE = [
  '**このブロックの使い方（厳守）**',
  '- 業者ごとの条件・数値・ツール対応可否は、このブロックに書かれた値だけを使う',
  '- ブロックに無い条件は書かない（「たぶん対応している」等の推測で埋めない）',
  '- 「MT4対応」のような要約語で条件を丸めない。書かれた条件文をそのまま条件付きで書く',
  '- 数値を書くときは確認日と適用条件を省略しない',
].join('\n');

const NO_FACTS_BLOCK = [
  '## 業者事実ブロック',
  '',
  '今回は業者事実が渡されていない。**業者固有の条件・数値・ツール対応可否は一切書かない**。',
  '一般的な仕組みの説明だけを書き、社名を出した条件の断定をしない。',
].join('\n');

function daysSince(dateStr) {
  const then = Date.parse(dateStr);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - then) / 86400000);
}

/** 正本が読める環境（ローカル）でのみ、派生JSONが古くないかを突合する */
function warnIfStaleAgainstSource(data) {
  const sourcePath = path.join(AFFILIATE_ROOT, data.source?.path || '');
  if (!data.source?.path || !fs.existsSync(sourcePath)) return; // CIでは正本が無い＝突合しない
  const sha = crypto.createHash('sha256').update(fs.readFileSync(sourcePath, 'utf-8')).digest('hex');
  if (sha !== data.source.sha256) {
    console.warn(`⚠️ data/broker-facts.json が正本(${data.source.path})より古い。node scripts/sync-broker-facts.mjs を実行してください。`);
  }
}

/**
 * @param {string[]} fieldKeys 渡す項目（未指定なら全項目）
 * @returns {string} プロンプトへ差し込む業者事実ブロック
 */
export function buildBrokerFactsBlock(fieldKeys = null) {
  if (!fs.existsSync(FACTS_PATH)) {
    console.warn(`⚠️ ${path.relative(ROOT, FACTS_PATH)} が無い。業者事実なしで生成する（業者条件は書かせない）。`);
    return NO_FACTS_BLOCK;
  }
  const data = JSON.parse(fs.readFileSync(FACTS_PATH, 'utf-8'));
  warnIfStaleAgainstSource(data);

  const limit = data.stale_after_days ?? 90;
  let staleCount = 0;
  const sections = [];

  for (const broker of data.brokers) {
    const facts = broker.facts.filter((fact) => {
      if (fieldKeys && !fieldKeys.includes(fact.key)) return false;
      if (daysSince(fact.checked) > limit) {
        staleCount += 1; // 正本 meta.policy の再確認期限切れ。古い条件を先生層へ流さない
        return false;
      }
      return true;
    });
    if (facts.length === 0) continue;
    const lines = [`### ${broker.service}`, `- 記事URL: ${broker.url}`];
    facts.forEach((fact) => lines.push(`- ${fact.label}（公式確認 ${fact.checked}）: ${fact.value}`));
    if (broker.notes) lines.push(`- 表記注意: ${broker.notes}`);
    sections.push(lines.join('\n'));
  }

  if (staleCount > 0) {
    console.warn(`⚠️ 確認日が${limit}日を超えた事実を${staleCount}件除外した。正本の再確認が必要。`);
  }
  if (sections.length === 0) return NO_FACTS_BLOCK;

  return [
    '## 業者事実ブロック（正本: AI運用/データ正本/brokers_*.yaml）',
    '',
    USAGE_RULE,
    '',
    sections.join('\n\n'),
  ].join('\n');
}

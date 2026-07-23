#!/usr/bin/env node
/**
 * データ正本（AI運用/データ正本/brokers_*.yaml）から、生成系が読む
 * data/broker-facts.json を作り直す。DOCTRINE-D02-b（先生層の事実分離）。
 *
 * なぜ中間JSONを置くか:
 *   正本YAMLは別リポジトリ（Lofikota/affiliate-ai-ops）にあり、GitHub Actions が
 *   checkout するのは tsumiba-blog だけなので、CI実行時に正本ファイルは存在しない。
 *   そこで「正本＝YAML（人が編集する唯一の場所）」「broker-facts.json＝機械生成の派生物
 *   （コミットしてCIへ持ち込む）」に分ける。JSONは手で編集しない。
 *   ずれはローダ側が source.sha256 の突合で検知する（正本が読める環境でのみ）。
 *
 * 事実の衛生管理（ここでやること）:
 *   - value が「未確認」で始まる / checked が無い項目は落とす（未確認値を生成系へ渡さない）
 *   - tier: core かつ実在する公開記事slugを持つ業者だけを対象にする
 *   - 表示ラベルと確認日を持たせる（先生層が確認日を省略できないようにする）
 *
 * 実行: node scripts/sync-broker-facts.mjs （npm run brokers:sync でも可）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AFFILIATE_ROOT = path.join(ROOT, '..');
const SOURCE_DIR = path.join(AFFILIATE_ROOT, 'AI運用/データ正本');
const OUTPUT_PATH = path.join(ROOT, 'data/broker-facts.json');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');

// 生成系プロンプトへ渡す事実の項目とラベル（正本YAMLのキー名 → 日本語ラベル）
const FACT_FIELDS = [
  ['min_unit', '最低取引単位'],
  ['currency_pairs', '通貨ペア数'],
  ['spread', 'スプレッド'],
  ['margin_per_1000', '必要証拠金'],
  ['losscut', 'ロスカット'],
  ['margin_call', '追証'],
  ['app', 'スマホアプリ'],
  ['demo', 'デモ口座'],
  ['mt4_ea', 'MT4・EA'],
  ['kyc', '本人確認'],
  ['age_requirement', '年齢条件'],
  ['campaign', 'キャンペーン'],
];

function loadYaml(file) {
  // js-yaml は astro の直接依存として node_modules に入っている。
  // このスクリプトはローカル運用専用（CIは生成済みJSONだけを読む）なので依存追加はしない。
  return import('js-yaml')
    .then((mod) => (mod.default ?? mod).load(fs.readFileSync(file, 'utf-8')))
    .catch((e) => {
      if (e.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('js-yaml が見つかりません。tsumiba-blog で `npm install` を実行してください。');
        process.exit(1);
      }
      throw e;
    });
}

/** 正本は日付サフィックス付きで更新されるため、最新版を自動で選ぶ */
function findSourceFile() {
  if (!fs.existsSync(SOURCE_DIR)) return null;
  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((name) => /^brokers_\d{4}-\d{2}-\d{2}\.ya?ml$/.test(name))
    .sort();
  return files.length > 0 ? path.join(SOURCE_DIR, files[files.length - 1]) : null;
}

/** 業者idから公開中の記事slugを解決する（先生層にURLを直書きしないため） */
function resolveSlug(id) {
  for (const candidate of [`${id}-review`, `${id}-fx-review`]) {
    const file = path.join(BLOG_DIR, `${candidate}.mdx`);
    if (!fs.existsSync(file)) continue;
    const frontmatter = (fs.readFileSync(file, 'utf-8').match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1];
    if (/^draft:\s*true\s*$/m.test(frontmatter)) continue; // 下書き記事へは誘導しない
    return candidate;
  }
  return null;
}

function isVerified(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const value = entry.value;
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (value.startsWith('未確認')) return false;
  return Boolean(entry.checked); // 確認日のない値は「確認済み」と扱わない
}

const sourceFile = findSourceFile();
if (!sourceFile) {
  console.error(`正本が見つかりません: ${SOURCE_DIR}/brokers_YYYY-MM-DD.yaml`);
  console.error('affiliate-ai-ops リポジトリ（AI運用/）が隣に無い環境では同期できません。');
  process.exit(1);
}

const raw = fs.readFileSync(sourceFile, 'utf-8');
const doc = await loadYaml(sourceFile);

let droppedUnverified = 0;
let droppedNoSlug = [];
const brokers = [];

for (const broker of doc.brokers || []) {
  if (broker.tier !== 'core') continue;
  const slug = resolveSlug(broker.id);
  if (!slug) {
    droppedNoSlug.push(broker.id);
    continue;
  }
  const facts = [];
  for (const [key, label] of FACT_FIELDS) {
    const entry = broker[key];
    if (!isVerified(entry)) {
      if (entry) droppedUnverified += 1;
      continue;
    }
    facts.push({ key, label, value: String(entry.value).trim(), checked: entry.checked });
  }
  const registration = broker.company?.registration;
  if (typeof registration === 'string' && !registration.startsWith('未確認') && broker.company?.checked) {
    facts.unshift({
      key: 'registration',
      label: '登録番号',
      value: registration,
      checked: broker.company.checked,
    });
  }
  brokers.push({
    id: broker.id,
    service: broker.service,
    url: `tsumiba.com/blog/${slug}/`,
    notes: typeof broker.notes === 'string' ? broker.notes : null,
    facts,
  });
}

const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  generator: 'scripts/sync-broker-facts.mjs',
  warning: 'このファイルは自動生成物。手で編集しないこと。正本はsource.pathのYAML',
  source: {
    path: path.relative(AFFILIATE_ROOT, sourceFile),
    updated: doc.meta?.created ?? null,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  },
  // 正本 meta.policy「checkedが90日超の項目は再確認する」をコード側の期限として持つ
  stale_after_days: 90,
  brokers,
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

console.log(`正本: ${output.source.path}`);
console.log(`出力: ${path.relative(ROOT, OUTPUT_PATH)}`);
console.log(`業者: ${brokers.length}社 / 事実: ${brokers.reduce((n, b) => n + b.facts.length, 0)}件`);
console.log(`未確認のため除外した項目: ${droppedUnverified}件`);
if (droppedNoSlug.length > 0) {
  console.log(`公開記事slugが無いため除外: ${droppedNoSlug.join(', ')}`);
}

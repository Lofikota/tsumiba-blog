#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, 'true');
    }
  }
}

const input = args.get('input');
const outDir = args.get('out-dir') || '../KPI管理/search-console';
const reportDate = args.get('date') || new Date().toISOString().slice(0, 10);

if (!input) {
  console.error('Usage: node scripts/import-search-console.mjs --input path/to/search-console.csv [--date YYYY-MM-DD]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function pick(row, headers, candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeHeader(candidate);
    const index = headers.findIndex((header) => header === normalized);
    if (index !== -1) return row[index] ?? '';
  }
  return '';
}

function parseNumber(value) {
  if (!value) return 0;
  const cleaned = String(value).replace(/[%,"\s]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '0.00%';
  return `${value.toFixed(2)}%`;
}

function formatPosition(value) {
  if (!Number.isFinite(value)) return '-';
  return value.toFixed(1);
}

const csvPath = resolve(input);
const rows = parseCsv(readFileSync(csvPath, 'utf8'));
if (rows.length < 2) {
  console.error(`No data rows found: ${csvPath}`);
  process.exit(1);
}

const headers = rows[0].map(normalizeHeader);
const data = rows.slice(1).map((row) => {
  const key =
    pick(row, headers, ['Top queries', 'Queries', 'Query', '検索キーワード', 'クエリ', '上位のクエリ']) ||
    pick(row, headers, ['Top pages', 'Pages', 'Page', 'ページ', '上位のページ']);
  const clicks = parseNumber(pick(row, headers, ['Clicks', 'クリック数', 'クリック']));
  const impressions = parseNumber(pick(row, headers, ['Impressions', '表示回数', '表示']));
  const ctrRaw = pick(row, headers, ['CTR', 'クリック率']);
  const ctr = ctrRaw.includes('%') ? parseNumber(ctrRaw) : parseNumber(ctrRaw) * 100;
  const position = parseNumber(pick(row, headers, ['Position', '掲載順位', '平均掲載順位']));

  return { key, clicks, impressions, ctr, position };
}).filter((row) => row.key);

const totals = data.reduce(
  (acc, row) => {
    acc.clicks += row.clicks;
    acc.impressions += row.impressions;
    return acc;
  },
  { clicks: 0, impressions: 0 },
);
const weightedCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;

const topClicks = [...data].sort((a, b) => b.clicks - a.clicks).slice(0, 20);
const highImpressionLowCtr = data
  .filter((row) => row.impressions >= 50 && row.ctr < 3)
  .sort((a, b) => b.impressions - a.impressions)
  .slice(0, 20);
const nearTop = data
  .filter((row) => row.position >= 4 && row.position <= 15 && row.impressions >= 20)
  .sort((a, b) => a.position - b.position || b.impressions - a.impressions)
  .slice(0, 20);

function table(rowsForTable) {
  if (rowsForTable.length === 0) return '該当なし\n';
  return [
    '| キーワード/ページ | クリック | 表示回数 | CTR | 平均順位 |',
    '|---|---:|---:|---:|---:|',
    ...rowsForTable.map((row) =>
      `| ${row.key.replace(/\|/g, '\\|')} | ${row.clicks} | ${row.impressions} | ${formatPercent(row.ctr)} | ${formatPosition(row.position)} |`,
    ),
  ].join('\n') + '\n';
}

const markdown = `# Search Console レポート ${reportDate}

取り込み元: \`${basename(csvPath)}\`

## サマリー

| 指標 | 数値 |
|---|---:|
| 行数 | ${data.length} |
| クリック | ${totals.clicks} |
| 表示回数 | ${totals.impressions} |
| 全体CTR | ${formatPercent(weightedCtr)} |

## クリック上位

${table(topClicks)}

## 表示はあるがCTRが低い候補

タイトル改善・メタディスクリプション改善・FAQ追記の候補。

${table(highImpressionLowCtr)}

## 4位〜15位の押し上げ候補

内部リンク追加・FAQ追記・見出し調整・体験談追加の候補。

${table(nearTop)}

## 次アクション

- CTRが低い上位ページは、タイトルと導入文を先に見直す。
- 4位〜15位のクエリは、該当記事にFAQ・比較表・内部リンクを追加する。
- LINE導線を持つ記事は、LINE Harness側の \`ref\` と照合して登録・クリックまで見る。
- ASP成果が出た週は、A8等の管理画面の成果CSVと突き合わせる。
`;

const outputDir = resolve(outDir);
mkdirSync(outputDir, { recursive: true });
const outputPath = resolve(outputDir, `${reportDate}.md`);
writeFileSync(outputPath, markdown);

console.log(`Search Console report written: ${outputPath}`);

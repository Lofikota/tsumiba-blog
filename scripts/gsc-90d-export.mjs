#!/usr/bin/env node
/**
 * GSC 直近90日エクスポート（顧客検証G-C 条件6 突合用）
 *
 * 正本: AI運用/戦略/顧客仮説検証設計_BIZ-GA-CUSTOMER01_2026-07-26.md §8-1
 *   - 検索タイプ「ウェブ」/ デバイス「モバイル」
 *   - クエリ・ページ・クリック・表示・CTR・平均掲載順位
 *   - GSCの匿名化・行欠落は「欠損」として残す（0補完しない）
 *
 * 既存の gsc-api.mjs は device/searchType フィルタを持たないため別スクリプトにした。
 * 認証は gsc-api.mjs と同じ（ADC または GSC_SERVICE_ACCOUNT_JSON）。
 *
 * 使い方:
 *   node scripts/gsc-90d-export.mjs [--end YYYY-MM-DD] [--out /path/to/dir]
 */
import { google } from 'googleapis';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SITE_URL = process.env.GSC_SITE_URL || 'https://tsumiba.com/';

const args = process.argv.slice(2);
const argVal = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const OUT_DIR = argVal('--out') || join(__dir, '..', '..', '計測データ', 'GSC-GA4突合');

function getAuth() {
  const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
  const encoded = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (encoded) {
    const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    return new google.auth.GoogleAuth({ credentials: json, scopes });
  }
  return new google.auth.GoogleAuth({ scopes });
}

const fmt = d => d.toISOString().split('T')[0];
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const MOBILE_WEB = {
  type: 'web',
  dimensionFilterGroups: [
    { filters: [{ dimension: 'device', operator: 'equals', expression: 'MOBILE' }] },
  ],
};

async function query(wm, body) {
  const res = await wm.searchanalytics.query({ siteUrl: SITE_URL, requestBody: body });
  return res.data.rows || [];
}

function toCsv(header, rows) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n') + '\n';
}

const main = async () => {
  const auth = getAuth();
  const wm = google.webmasters({ version: 'v3', auth });

  // 終了日: 指定がなければ「実データが存在する最新日」を探す（GSCは2〜3日遅延）
  const today = new Date();
  let endDate = argVal('--end');
  const probeStart = fmt(addDays(today, -20));
  const probe = await query(wm, {
    startDate: probeStart, endDate: fmt(today), dimensions: ['date'], rowLimit: 30, type: 'web',
  });
  const latestWithData = probe.length ? probe[probe.length - 1].keys[0] : null;
  if (!endDate) endDate = latestWithData || fmt(addDays(today, -3));

  const startDate = fmt(addDays(new Date(endDate), -89)); // 90日（両端含む）

  // 1. 日別（全デバイス・web）— データが実在する日を確定し、欠損日を「欠損」として残す
  const byDate = await query(wm, {
    startDate, endDate, dimensions: ['date'], rowLimit: 500, type: 'web',
  });
  // 1b. 日別（モバイル・web）
  const byDateMobile = await query(wm, {
    startDate, endDate, dimensions: ['date'], rowLimit: 500, ...MOBILE_WEB,
  });

  // 2. 期間合計（フィルタなし＝匿名化前の真の合計）
  const totalAll = await query(wm, { startDate, endDate, dimensions: [], rowLimit: 1, type: 'web' });
  const totalMobile = await query(wm, { startDate, endDate, dimensions: [], rowLimit: 1, ...MOBILE_WEB });

  // 3. クエリ別（モバイル・web）
  const byQuery = await query(wm, {
    startDate, endDate, dimensions: ['query'], rowLimit: 5000, ...MOBILE_WEB,
  });
  // 3b. クエリ別（全デバイス）— モバイル母数が薄い場合の参考。§8-1条件ではない
  const byQueryAll = await query(wm, {
    startDate, endDate, dimensions: ['query'], rowLimit: 5000, type: 'web',
  });

  // 4. ページ別（モバイル・web）
  const byPage = await query(wm, {
    startDate, endDate, dimensions: ['page'], rowLimit: 5000, ...MOBILE_WEB,
  });
  const byPageAll = await query(wm, {
    startDate, endDate, dimensions: ['page'], rowLimit: 5000, type: 'web',
  });

  // 5. クエリ×ページ（モバイル・web）— コード対応マーク表の材料
  const byQueryPage = await query(wm, {
    startDate, endDate, dimensions: ['query', 'page'], rowLimit: 5000, ...MOBILE_WEB,
  });
  const byQueryPageAll = await query(wm, {
    startDate, endDate, dimensions: ['query', 'page'], rowLimit: 5000, type: 'web',
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const w = (name, csv) => { writeFileSync(join(OUT_DIR, name), csv, 'utf-8'); return name; };

  const m = r => [r.clicks, r.impressions, (r.ctr * 100).toFixed(2), r.position.toFixed(2)];
  const H4 = ['clicks', 'impressions', 'ctr_pct', 'position'];

  const files = [
    w('gsc_date_web_all-devices.csv', toCsv(['date', ...H4], byDate.map(r => [r.keys[0], ...m(r)]))),
    w('gsc_date_web_mobile.csv', toCsv(['date', ...H4], byDateMobile.map(r => [r.keys[0], ...m(r)]))),
    w('gsc_query_web_mobile.csv', toCsv(['query', ...H4], byQuery.map(r => [r.keys[0], ...m(r)]))),
    w('gsc_query_web_all-devices.csv', toCsv(['query', ...H4], byQueryAll.map(r => [r.keys[0], ...m(r)]))),
    w('gsc_page_web_mobile.csv', toCsv(['page', ...H4], byPage.map(r => [r.keys[0], ...m(r)]))),
    w('gsc_page_web_all-devices.csv', toCsv(['page', ...H4], byPageAll.map(r => [r.keys[0], ...m(r)]))),
    w('gsc_query-page_web_mobile.csv', toCsv(['query', 'page', ...H4], byQueryPage.map(r => [r.keys[0], r.keys[1], ...m(r)]))),
    w('gsc_query-page_web_all-devices.csv', toCsv(['query', 'page', ...H4], byQueryPageAll.map(r => [r.keys[0], r.keys[1], ...m(r)]))),
  ];

  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  const t = rows => (rows[0] ? { clicks: rows[0].clicks, impressions: rows[0].impressions } : { clicks: 0, impressions: 0 });

  const meta = {
    取得日: fmt(today),
    サイト: SITE_URL,
    期間: { start: startDate, end: endDate, 日数: 90 },
    GSC最新データ日: latestWithData,
    データが実在する日: { 全デバイス: byDate.length, モバイル: byDateMobile.length },
    実データ日付範囲: byDate.length ? { 最古: byDate[0].keys[0], 最新: byDate[byDate.length - 1].keys[0] } : null,
    期間合計_ウェブ全デバイス: t(totalAll),
    期間合計_ウェブモバイル: t(totalMobile),
    行数: {
      クエリ_モバイル: byQuery.length, クエリ_全デバイス: byQueryAll.length,
      ページ_モバイル: byPage.length, ページ_全デバイス: byPageAll.length,
      'クエリ×ページ_モバイル': byQueryPage.length, 'クエリ×ページ_全デバイス': byQueryPageAll.length,
    },
    匿名化欠損_モバイル: {
      合計表示: t(totalMobile).impressions,
      クエリ行合計表示: sum(byQuery, 'impressions'),
      欠損表示: t(totalMobile).impressions - sum(byQuery, 'impressions'),
      合計クリック: t(totalMobile).clicks,
      クエリ行合計クリック: sum(byQuery, 'clicks'),
      欠損クリック: t(totalMobile).clicks - sum(byQuery, 'clicks'),
      注記: '差分は0補完せず「欠損」として扱う（正本 §8-2-5）',
    },
    出力ファイル: files,
  };
  w('gsc_meta.json', JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
};

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

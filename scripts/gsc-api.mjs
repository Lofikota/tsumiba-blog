#!/usr/bin/env node
/**
 * Google Search Console API クライアント
 * 環境変数: GSC_SERVICE_ACCOUNT_JSON (base64エンコードされたサービスアカウントJSON)
 *           GSC_SITE_URL (例: https://ren-money.com/)
 */
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ローカル開発用: .env ファイルを手動ロード（dotenv不要）
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SITE_URL = process.env.GSC_SITE_URL || 'https://ren-money.com/';

function getAuth() {
  const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];

  // GitHub Actions: サービスアカウントJSONをbase64で渡す
  const encoded = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (encoded) {
    const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    return new google.auth.GoogleAuth({ credentials: json, scopes });
  }

  // ローカル開発: gcloud application-default credentials を自動検出
  return new google.auth.GoogleAuth({ scopes });
}

/**
 * 直近N日間のページ別検索パフォーマンスを取得
 * @returns {Array<{page, clicks, impressions, ctr, position, queries}>}
 */
export async function fetchSearchAnalytics(days = 28) {
  const auth = getAuth();
  const webmasters = google.webmasters({ version: 'v3', auth });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const fmt = d => d.toISOString().split('T')[0];

  // ページ別集計
  const pageRes = await webmasters.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['page'],
      rowLimit: 50,
    },
  });

  const pages = pageRes.data.rows || [];

  // 各ページのクエリ上位10件を取得
  const results = await Promise.all(
    pages.map(async row => {
      const page = row.keys[0];
      try {
        const qRes = await webmasters.searchanalytics.query({
          siteUrl: SITE_URL,
          requestBody: {
            startDate: fmt(startDate),
            endDate: fmt(endDate),
            dimensions: ['query'],
            dimensionFilterGroups: [
              {
                filters: [{ dimension: 'page', operator: 'equals', expression: page }],
              },
            ],
            rowLimit: 10,
          },
        });
        return {
          page,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          queries: (qRes.data.rows || []).map(q => ({
            query: q.keys[0],
            clicks: q.clicks,
            impressions: q.impressions,
            position: q.position,
          })),
        };
      } catch {
        return { page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, queries: [] };
      }
    })
  );

  return results;
}

// CLI実行時: 結果をJSONで出力
if (process.argv[1].endsWith('gsc-api.mjs')) {
  const data = await fetchSearchAnalytics(28);
  console.log(JSON.stringify(data, null, 2));
}

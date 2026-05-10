#!/usr/bin/env node
/**
 * 週次KPI自動集計スクリプト
 *
 * 収集データ:
 *   - Xフォロワー数（X API v2）
 *   - ブログ検索パフォーマンス週次（Google Search Console API）
 *   - LINE登録者数（LINE Messaging API）
 *
 * 出力:
 *   - data/kpi-snapshots.json  … 週次スナップショット履歴（52週保持）
 *   - KPI管理/weekly/YYYY-WW.md … 週次詳細レポート
 *   - KPI管理/kpi-dashboard.md … 常時最新の自動集計ダッシュボード
 *   - LINE通知（Phase1進捗付き）
 *
 * 環境変数:
 *   X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET
 *   GSC_SERVICE_ACCOUNT_JSON（base64）/ GSC_SITE_URL
 *   LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID
 */

import { TwitterApi } from 'twitter-api-v2';
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// ──────────────────────────────────────────
// ローカル開発用 .env ロード
// ──────────────────────────────────────────
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ──────────────────────────────────────────
// 日付ユーティリティ
// ──────────────────────────────────────────
const toJST = (d = new Date()) => new Date(d.getTime() + 9 * 60 * 60 * 1000);
const fmt = d => d.toISOString().split('T')[0];

const now = toJST();
const todayStr = fmt(now);

// ISO 週番号
const getISOWeek = d => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const w1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
};

const weekNum = getISOWeek(now);
const year = now.getFullYear();
const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;

// 今週の月曜〜日曜（JST）
const dow = now.getDay() || 7;
const monday = new Date(now); monday.setDate(now.getDate() - dow + 1);
const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
const weekStartStr = fmt(monday);
const weekEndStr = fmt(sunday < now ? sunday : now); // GSCは今日まで
const weekRange = `${monday.getMonth() + 1}/${monday.getDate()}〜${sunday.getMonth() + 1}/${sunday.getDate()}`;

console.log(`\n🚀 週次KPI集計開始 [${weekKey}] ${weekRange}\n`);

// ──────────────────────────────────────────
// X API: フォロワー数・ツイート数を取得
// ──────────────────────────────────────────
async function fetchXMetrics() {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  if (!X_API_KEY || !X_ACCESS_TOKEN) {
    console.warn('⚠️  X API 環境変数未設定 — スキップ');
    return null;
  }
  try {
    const client = new TwitterApi({
      appKey: X_API_KEY,
      appSecret: X_API_SECRET,
      accessToken: X_ACCESS_TOKEN,
      accessSecret: X_ACCESS_TOKEN_SECRET,
    });
    const me = await client.v2.me({ 'user.fields': ['public_metrics', 'name', 'username'] });
    const pm = me.data.public_metrics;
    console.log(`✅ X: @${me.data.username} フォロワー ${pm.followers_count.toLocaleString()}人`);
    return {
      followersCount: pm.followers_count,
      followingCount: pm.following_count,
      tweetCount: pm.tweet_count,
      username: me.data.username,
    };
  } catch (e) {
    console.warn(`⚠️  X API エラー: ${e.message}`);
    return null;
  }
}

// ──────────────────────────────────────────
// GSC API: 週次サイト全体パフォーマンス取得
// ──────────────────────────────────────────
async function fetchGSCWeekly() {
  const { GSC_SERVICE_ACCOUNT_JSON, GSC_SITE_URL } = process.env;
  if (!GSC_SERVICE_ACCOUNT_JSON && !existsSync(join(ROOT, '.env'))) {
    console.warn('⚠️  GSC 環境変数未設定 — スキップ');
    return null;
  }
  try {
    const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
    let auth;
    if (GSC_SERVICE_ACCOUNT_JSON) {
      const creds = JSON.parse(Buffer.from(GSC_SERVICE_ACCOUNT_JSON, 'base64').toString('utf-8'));
      auth = new google.auth.GoogleAuth({ credentials: creds, scopes });
    } else {
      auth = new google.auth.GoogleAuth({ scopes });
    }
    const wm = google.webmasters({ version: 'v3', auth });
    const siteUrl = GSC_SITE_URL || 'https://ren-money.com/';

    // 日別集計で週次合計を算出（集計ズレ防止）
    const [dateRes, pageRes] = await Promise.all([
      wm.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: weekStartStr,
          endDate: weekEndStr,
          dimensions: ['date'],
          rowLimit: 7,
        },
      }),
      wm.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: weekStartStr,
          endDate: weekEndStr,
          dimensions: ['page'],
          rowLimit: 10,
        },
      }),
    ]);

    const dateRows = dateRes.data.rows || [];
    const totalClicks = dateRows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = dateRows.reduce((s, r) => s + r.impressions, 0);
    const avgCtr = totalImpressions > 0
      ? Math.round((totalClicks / totalImpressions) * 10000) / 100
      : 0;
    const avgPosition = dateRows.length > 0
      ? Math.round((dateRows.reduce((s, r) => s + r.position, 0) / dateRows.length) * 10) / 10
      : 0;

    const topPages = (pageRes.data.rows || []).slice(0, 5).map(r => ({
      page: r.keys[0].replace(siteUrl.replace(/\/$/, ''), ''),
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
    }));

    console.log(`✅ GSC: ${weekStartStr}〜${weekEndStr} | クリック ${totalClicks} / 表示 ${totalImpressions}`);
    return { clicks: totalClicks, impressions: totalImpressions, ctr: avgCtr, position: avgPosition, topPages, period: `${weekStartStr}〜${weekEndStr}` };
  } catch (e) {
    console.warn(`⚠️  GSC API エラー: ${e.message}`);
    return null;
  }
}

// ──────────────────────────────────────────
// LINE Messaging API: 友だち数取得
// ──────────────────────────────────────────
async function fetchLINEFollowers() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.warn('⚠️  LINE_CHANNEL_ACCESS_TOKEN 未設定 — スキップ');
    return null;
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/followers/count', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`⚠️  LINE API ${res.status} — フォロワー数取得スキップ`);
      return null;
    }
    const data = await res.json();
    console.log(`✅ LINE: 友だち ${data.count}人`);
    return { count: data.count };
  } catch (e) {
    console.warn(`⚠️  LINE API エラー: ${e.message}`);
    return null;
  }
}

// ──────────────────────────────────────────
// スナップショット管理
// ──────────────────────────────────────────
const SNAPSHOT_PATH = join(ROOT, 'data/kpi-snapshots.json');

function loadSnapshots() {
  if (!existsSync(SNAPSHOT_PATH)) return [];
  try { return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')); } catch { return []; }
}

function saveSnapshot(snap, all) {
  const idx = all.findIndex(s => s.weekKey === snap.weekKey);
  if (idx >= 0) all[idx] = snap; else all.push(snap);
  const sorted = all.sort((a, b) => a.weekKey.localeCompare(b.weekKey)).slice(-52);
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(sorted, null, 2));
  return sorted;
}

function getPrev(all) {
  return all.filter(s => s.weekKey < weekKey).sort((a, b) => b.weekKey.localeCompare(a.weekKey))[0] ?? null;
}

// ──────────────────────────────────────────
// 差分フォーマットユーティリティ
// ──────────────────────────────────────────
const delta = (cur, prev, unit = '') => {
  if (cur === null) return '未取得';
  if (prev === null) return `${cur.toLocaleString()}${unit}`;
  const d = cur - prev;
  const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
  return `${cur.toLocaleString()}${unit}（${d >= 0 ? '+' : ''}${d.toLocaleString()}${unit} ${arrow}）`;
};

const progressBar = (val, goal, width = 20) => {
  const pct = Math.min(100, Math.round((val / goal) * 100));
  const filled = Math.floor(pct / (100 / width));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${pct}%`;
};

// ──────────────────────────────────────────
// Phase1_KPI.md 週次テーブル更新
// ──────────────────────────────────────────
const KPI_MD_PATH = join(ROOT, 'KPI管理/Phase1_KPI.md');

function updatePhase1KPI(snap, prev) {
  if (!existsSync(KPI_MD_PATH)) {
    console.warn(`⚠️  ${KPI_MD_PATH} が存在しません — KPI管理/Phase1_KPI.md をスキップ`);
    return;
  }

  const followerIncrease = (prev?.xFollowers != null && snap.xFollowers != null)
    ? snap.xFollowers - prev.xFollowers
    : null;

  let content = readFileSync(KPI_MD_PATH, 'utf-8');
  const lines = content.split('\n');
  let inWeeklyTable = false;
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('X投稿（週次確認）')) { inWeeklyTable = true; continue; }
    if (inWeeklyTable && /^###/.test(lines[i])) inWeeklyTable = false;

    if (inWeeklyTable && lines[i].includes(weekRange)) {
      const cols = lines[i].split('|');
      // | 週 | 投稿数 | フォロワー増 | 高インプレッション投稿 |
      //  0    1       2             3                    4
      if (cols.length >= 5 && followerIncrease !== null) {
        cols[2] = ` ${followerIncrease >= 0 ? '+' : ''}${followerIncrease}人 `;
      }
      if (cols.length >= 5 && snap.xFollowers != null) {
        // 投稿数列は空のまま（X APIの週次ツイート数は別途）
      }
      lines[i] = cols.join('|');
      updated = true;
      console.log(`✅ Phase1_KPI.md 更新: ${weekRange} フォロワー増 ${followerIncrease != null ? (followerIncrease >= 0 ? '+' : '') + followerIncrease + '人' : '前週データなし'}`);
    }
  }

  if (!updated) {
    // 対応する週行がない場合は週テーブルに追記
    const weekTableEndIdx = lines.findIndex((l, i) =>
      i > lines.findIndex(ll => ll.includes('X投稿（週次確認）')) && l.startsWith('###')
    );
    if (weekTableEndIdx > 0) {
      const newRow = `| ${weekRange} | | ${followerIncrease != null ? (followerIncrease >= 0 ? '+' : '') + followerIncrease + '人' : ''} | |`;
      lines.splice(weekTableEndIdx, 0, newRow);
      console.log(`✅ Phase1_KPI.md 新規行追加: ${weekRange}`);
    }
  }

  writeFileSync(KPI_MD_PATH, lines.join('\n'));
}

// ──────────────────────────────────────────
// 週次詳細レポート生成（KPI管理/weekly/）
// ──────────────────────────────────────────
const WEEKLY_DIR = join(ROOT, 'KPI管理/weekly');

function generateWeeklyReport(snap, prev, gsc) {
  if (!existsSync(WEEKLY_DIR)) mkdirSync(WEEKLY_DIR, { recursive: true });

  const followerIncrease = (prev?.xFollowers != null && snap.xFollowers != null)
    ? snap.xFollowers - prev.xFollowers : null;
  const phase1Pct = snap.xFollowers != null
    ? Math.min(100, Math.round((snap.xFollowers / 1000) * 100)) : 0;

  const gscSection = gsc ? `
## 📈 検索パフォーマンス（${gsc.period}）

| 指標 | 実績 |
|---|---|
| クリック数 | ${gsc.clicks.toLocaleString()} 回 |
| 表示回数 | ${gsc.impressions.toLocaleString()} 回 |
| 平均CTR | ${gsc.ctr} % |
| 平均掲載順位 | ${gsc.position} 位 |

### クリック上位ページ

${gsc.topPages?.map(p =>
  `| \`${p.page}\` | ${p.clicks}クリック | ${p.impressions}表示 | ${p.position}位 |`
).join('\n') || 'データなし'}
` : '\n## 📈 検索パフォーマンス\n\nデータ取得失敗（GSC未設定またはAPIエラー）\n';

  const lineSection = snap.lineFollowers != null
    ? `\n## 💌 LINE友だち数\n\n${delta(snap.lineFollowers, prev?.lineFollowers ?? null, '人')}\n`
    : '';

  const md = `# 週次KPIレポート ${weekKey}（${weekRange}）

> 🤖 kpi-collector.mjs による自動集計 — ${todayStr}
> Phase1目標: Xフォロワー1,000人 / 月収10〜50万円

---

## 🐦 Xフォロワー

| 指標 | 実績 |
|---|---|
| フォロワー数 | ${delta(snap.xFollowers, prev?.xFollowers ?? null, '人')} |
| 今週の増加 | ${followerIncrease != null ? `${followerIncrease >= 0 ? '+' : ''}${followerIncrease}人` : '前週データなし'} |
| 総ツイート数 | ${snap.tweetCount != null ? snap.tweetCount.toLocaleString() : '未取得'} |

### Phase1進捗: Xフォロワー 1,000人目標

\`\`\`
${progressBar(snap.xFollowers ?? 0, 1000)}
残り ${Math.max(0, 1000 - (snap.xFollowers ?? 0)).toLocaleString()} 人
\`\`\`
${gscSection}${lineSection}
---

## 📊 前週との比較スナップショット

| 指標 | 先週 | 今週 | 差分 |
|---|---|---|---|
| Xフォロワー | ${prev?.xFollowers ?? '-'} | ${snap.xFollowers ?? '-'} | ${followerIncrease != null ? (followerIncrease >= 0 ? '+' : '') + followerIncrease : '-'} |
| GSCクリック | ${prev?.gsc?.clicks ?? '-'} | ${gsc?.clicks ?? '-'} | ${(prev?.gsc?.clicks != null && gsc?.clicks != null) ? (gsc.clicks - prev.gsc.clicks >= 0 ? '+' : '') + (gsc.clicks - prev.gsc.clicks) : '-'} |
| GSC表示回数 | ${prev?.gsc?.impressions ?? '-'} | ${gsc?.impressions ?? '-'} | ${(prev?.gsc?.impressions != null && gsc?.impressions != null) ? (gsc.impressions - prev.gsc.impressions >= 0 ? '+' : '') + (gsc.impressions - prev.gsc.impressions) : '-'} |
| LINE友だち | ${prev?.lineFollowers ?? '-'} | ${snap.lineFollowers ?? '-'} | ${(prev?.lineFollowers != null && snap.lineFollowers != null) ? (snap.lineFollowers - prev.lineFollowers >= 0 ? '+' : '') + (snap.lineFollowers - prev.lineFollowers) : '-'} |

---
*自動生成: kpi-collector.mjs | ${weekKey}*
`;

  const reportPath = join(WEEKLY_DIR, `${weekKey}.md`);
  writeFileSync(reportPath, md);
  console.log(`✅ 週次レポート生成: KPI管理/weekly/${weekKey}.md`);
  return md;
}

// ──────────────────────────────────────────
// kpi-dashboard.md を常時最新で上書き
// ──────────────────────────────────────────
const DASHBOARD_PATH = join(ROOT, 'KPI管理/kpi-dashboard.md');

function updateDashboard(snap, prev, gsc, allSnaps) {
  const followerIncrease = (prev?.xFollowers != null && snap.xFollowers != null)
    ? snap.xFollowers - prev.xFollowers : null;
  const phase1Pct = snap.xFollowers != null
    ? Math.min(100, Math.round((snap.xFollowers / 1000) * 100)) : 0;

  // 直近5週のトレンドテーブル
  const recent5 = allSnaps.slice(-5).reverse();
  const trendTable = recent5.map(s =>
    `| ${s.weekKey} | ${s.xFollowers?.toLocaleString() ?? '-'} | ${s.gsc?.clicks ?? '-'} | ${s.gsc?.impressions?.toLocaleString() ?? '-'} | ${s.lineFollowers ?? '-'} |`
  ).join('\n');

  const dashboard = `# KPI自動集計ダッシュボード

> 🤖 週次自動更新 — 最終集計: **${todayStr}**（${weekKey}）
> Phase1期間: 2026年4月26日〜7月31日

---

## 🎯 Phase1目標進捗

### Xフォロワー 1,000人
\`\`\`
${progressBar(snap.xFollowers ?? 0, 1000)}
現在: ${(snap.xFollowers ?? 0).toLocaleString()} 人 / 目標: 1,000人（残り ${Math.max(0, 1000 - (snap.xFollowers ?? 0)).toLocaleString()} 人）
\`\`\`

---

## 📊 今週のKPI（${weekRange}）

| 指標 | 今週 | 前週比 |
|---|---|---|
| 🐦 Xフォロワー | ${snap.xFollowers?.toLocaleString() ?? '未取得'} 人 | ${followerIncrease != null ? (followerIncrease >= 0 ? '+' : '') + followerIncrease + '人' : '-'} |
| 📈 GSCクリック | ${gsc?.clicks?.toLocaleString() ?? '未取得'} 回 | ${(prev?.gsc?.clicks != null && gsc?.clicks != null) ? (gsc.clicks - prev.gsc.clicks >= 0 ? '+' : '') + (gsc.clicks - prev.gsc.clicks) + '回' : '-'} |
| 👁️ GSC表示回数 | ${gsc?.impressions?.toLocaleString() ?? '未取得'} 回 | ${(prev?.gsc?.impressions != null && gsc?.impressions != null) ? (gsc.impressions - prev.gsc.impressions >= 0 ? '+' : '') + (gsc.impressions - prev.gsc.impressions) + '回' : '-'} |
| 🔍 平均CTR | ${gsc?.ctr ?? '未取得'} % | - |
| 📍 平均掲載順位 | ${gsc?.position ?? '未取得'} 位 | - |
| 💌 LINE友だち | ${snap.lineFollowers?.toLocaleString() ?? '未取得'} 人 | ${(prev?.lineFollowers != null && snap.lineFollowers != null) ? (snap.lineFollowers - prev.lineFollowers >= 0 ? '+' : '') + (snap.lineFollowers - prev.lineFollowers) + '人' : '-'} |

---

## 📅 週次トレンド（直近5週）

| 週 | Xフォロワー | GSCクリック | GSC表示回数 | LINE友だち |
|---|---|---|---|---|
${trendTable}

---

## 🔗 詳細レポート

直近の週次詳細は [KPI管理/weekly/](weekly/) を参照。

---
*🤖 kpi-collector.mjs により自動生成 | 毎週月曜 09:00 JST*
`;

  writeFileSync(DASHBOARD_PATH, dashboard);
  console.log('✅ kpi-dashboard.md 更新完了');
}

// ──────────────────────────────────────────
// LINE通知（KPIサマリー）
// ──────────────────────────────────────────
async function notifyLINE(snap, prev, gsc) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!token || !userId) {
    console.log('ℹ️  LINE通知スキップ（環境変数未設定）');
    return;
  }

  const followerIncrease = (prev?.xFollowers != null && snap.xFollowers != null)
    ? snap.xFollowers - prev.xFollowers : null;
  const phase1Pct = snap.xFollowers != null
    ? Math.min(100, Math.round((snap.xFollowers / 1000) * 100)) : 0;

  const lines = [
    `📊 週次KPIレポート [${weekRange}]`,
    '',
    `🐦 Xフォロワー: ${snap.xFollowers?.toLocaleString() ?? '?'}人`,
    followerIncrease != null
      ? `  前週比: ${followerIncrease >= 0 ? '+' : ''}${followerIncrease}人 ${followerIncrease > 0 ? '↑' : followerIncrease < 0 ? '↓' : '→'}`
      : '  前週比: データなし',
    `  Phase1進捗: ${phase1Pct}%（残り${Math.max(0, 1000 - (snap.xFollowers ?? 0)).toLocaleString()}人）`,
  ];

  if (gsc) {
    lines.push('');
    lines.push(`📈 ブログ検索（${gsc.period}）`);
    lines.push(`  クリック: ${gsc.clicks.toLocaleString()}回`);
    lines.push(`  表示: ${gsc.impressions.toLocaleString()}回`);
    lines.push(`  CTR: ${gsc.ctr}% / 平均順位: ${gsc.position}位`);
    if (gsc.topPages?.length > 0) {
      lines.push(`  TOP: ${gsc.topPages[0].page}（${gsc.topPages[0].clicks}クリック）`);
    }
  }

  if (snap.lineFollowers != null) {
    const lineDelta = prev?.lineFollowers != null ? snap.lineFollowers - prev.lineFollowers : null;
    lines.push('');
    lines.push(`💌 LINE友だち: ${snap.lineFollowers}人${lineDelta != null ? `（${lineDelta >= 0 ? '+' : ''}${lineDelta}人）` : ''}`);
  }

  const message = lines.join('\n');

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: message }] }),
    });
    if (res.ok) {
      console.log('✅ LINE通知送信完了');
    } else {
      console.warn(`⚠️  LINE通知失敗: ${res.status}`);
    }
  } catch (e) {
    console.warn(`⚠️  LINE通知エラー: ${e.message}`);
  }
}

// ──────────────────────────────────────────
// GitHub Actions 出力
// ──────────────────────────────────────────
function writeGitHubOutputs(snap, prev, gsc) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const followerIncrease = (prev?.xFollowers != null && snap.xFollowers != null)
    ? snap.xFollowers - prev.xFollowers : 0;
  const outputs = [
    `week_key=${weekKey}`,
    `week_range=${weekRange}`,
    `x_followers=${snap.xFollowers ?? 'N/A'}`,
    `follower_increase=${followerIncrease}`,
    `gsc_clicks=${gsc?.clicks ?? 'N/A'}`,
    `gsc_impressions=${gsc?.impressions ?? 'N/A'}`,
    `line_followers=${snap.lineFollowers ?? 'N/A'}`,
  ].join('\n');
  appendFileSync(outputFile, outputs + '\n');
  console.log('✅ GitHub Actions output 書き込み完了');
}

// ──────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────
const [xData, gsc, lineData] = await Promise.all([
  fetchXMetrics(),
  fetchGSCWeekly(),
  fetchLINEFollowers(),
]);

const allSnaps = loadSnapshots();
const prev = getPrev(allSnaps);

const snap = {
  weekKey,
  date: todayStr,
  weekRange,
  xFollowers: xData?.followersCount ?? null,
  tweetCount: xData?.tweetCount ?? null,
  xUsername: xData?.username ?? null,
  lineFollowers: lineData?.count ?? null,
  gsc: gsc ? {
    clicks: gsc.clicks,
    impressions: gsc.impressions,
    ctr: gsc.ctr,
    position: gsc.position,
  } : null,
};

const updatedSnaps = saveSnapshot(snap, allSnaps);
console.log(`\n📸 スナップショット保存: ${weekKey}\n`);

updatePhase1KPI(snap, prev);
generateWeeklyReport(snap, prev, gsc);
updateDashboard(snap, prev, gsc, updatedSnaps);
writeGitHubOutputs(snap, prev, gsc);
await notifyLINE(snap, prev, gsc);

console.log('\n✅ 週次KPI集計完了\n');

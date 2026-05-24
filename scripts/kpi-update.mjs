#!/usr/bin/env node
import fs from 'node:fs';

const now = new Date();
// ISO週番号を計算
const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const day = d.getUTCDay() || 7;
d.setUTCDate(d.getUTCDate() + 4 - day);
const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
const weekKey = `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;

const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');
const dateStr = `${now.getFullYear()}-${mm}-${dd}`;

const impressions = Number(process.env.INPUT_GSC_IMPRESSIONS) || 0;
const clicks = Number(process.env.INPUT_GSC_CLICKS) || 0;

const entry = {
  weekKey,
  date: dateStr,
  weekRange: `${mm}/${dd}`,
  xFollowers: Number(process.env.INPUT_X_FOLLOWERS),
  tweetCount: Number(process.env.INPUT_TWEET_COUNT),
  xUsername: 'tedori_asset',
  lineFollowers: Number(process.env.INPUT_LINE_FOLLOWERS) || null,
  gsc: {
    clicks,
    impressions,
    ctr: impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : 0,
    position: Number(process.env.INPUT_GSC_POSITION) || 0,
  },
};

const data = JSON.parse(fs.readFileSync('data/kpi-snapshots.json', 'utf8'));
const idx = data.findIndex(d => d.weekKey === weekKey);
if (idx >= 0) {
  data[idx] = entry;
  console.log('上書き:', weekKey);
} else {
  data.push(entry);
  console.log('追加:', weekKey);
}

fs.writeFileSync('data/kpi-snapshots.json', JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('完了:', JSON.stringify(entry, null, 2));

#!/usr/bin/env node
import fs from 'node:fs';

const month = process.env.INPUT_MONTH; // YYYY-MM
const total = Number(process.env.INPUT_TOTAL) || 0;
const fxRevenue = Number(process.env.INPUT_FX) || 0;
const insuranceRevenue = Number(process.env.INPUT_INSURANCE) || 0;
const notes = process.env.INPUT_NOTES || '';

if (!month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('月の形式が不正です（YYYY-MM で入力してください）');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync('data/revenue-log.json', 'utf8'));
const idx = data.findIndex(d => d.month === month);

const template = [
  { category: 'FX', asp: 'アクセストレード', product: 'DMM FX', clicks: 0, revenue: 0 },
  { category: 'FX', asp: 'アクセストレード', product: 'JFX', clicks: 0, revenue: 0 },
  { category: 'FX', asp: 'アクセストレード', product: 'FXTF', clicks: 0, revenue: 0 },
  { category: 'FX', asp: 'アクセストレード', product: 'FOREX.com', clicks: 0, revenue: 0 },
  { category: 'FX', asp: 'アクセストレード', product: 'GMOクリック証券FX', clicks: 0, revenue: 0 },
  { category: '保険', asp: 'A8.net', product: '保険見直し本舗', clicks: 0, revenue: 0 },
  { category: '保険', asp: 'A8.net', product: 'FPに相談', clicks: 0, revenue: 0 },
  { category: '保険', asp: 'A8.net', product: '保険ガーデン', clicks: 0, revenue: 0 },
  { category: '保険', asp: 'A8.net', product: '保険見直しラボ', clicks: 0, revenue: 0 },
];

if (idx >= 0) {
  data[idx].total = total;
  data[idx].notes = notes;
  console.log('上書き:', month);
} else {
  // FX・保険の収益を内訳で自動按分
  const entries = template.map(e => {
    if (e.category === 'FX') return { ...e, revenue: Math.round(fxRevenue / 5) };
    if (e.category === '保険') return { ...e, revenue: Math.round(insuranceRevenue / 4) };
    return e;
  });
  data.push({ month, entries, total, notes });
  console.log('追加:', month);
}

data.sort((a, b) => a.month.localeCompare(b.month));
fs.writeFileSync('data/revenue-log.json', JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('完了: 月次収益', month, total, '円');

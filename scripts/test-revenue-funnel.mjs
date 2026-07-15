#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const routes = [
  { article: 'fx-kouza-hikaku', broker: 'fxtf' },
  { article: 'dmm-fx-review', broker: 'dmm-fx' },
  { article: 'jfx-review', broker: 'jfx' },
];

const readBuiltPage = (...segments) => {
  const file = path.join(dist, ...segments, 'index.html');
  assert.ok(fs.existsSync(file), `ビルド済みページがありません: ${segments.join('/')}`);
  return fs.readFileSync(file, 'utf8');
};

const results = routes.map(({ article, broker }) => {
  const articleHtml = readBuiltPage('blog', article);
  assert.match(articleHtml, /article_view/, `${article}: article_view がありません`);
  assert.match(articleHtml, /data-google-event="article_cta_click"/, `${article}: CTAイベントがありません`);
  assert.ok(articleHtml.includes(`/go/${broker}/`), `${article}: /go/${broker}/ 導線がありません`);
  assert.doesNotMatch(articleHtml, /data-google-event="affiliate_click"/, `${article}: 記事側で affiliate_click が発火します`);

  const goHtml = readBuiltPage('go', broker);
  assert.match(goHtml, /go_page_view/, `${broker}: /go/到達イベントがありません`);
  assert.match(goHtml, /affiliate_click/, `${broker}: ASP送客イベントがありません`);
  assert.ok(goHtml.indexOf('go_page_view') < goHtml.indexOf('affiliate_click'), `${broker}: イベント順序が逆です`);
  assert.match(goHtml, /id="goButton"/, `${broker}: 手動送客ボタンがありません`);
  assert.match(goHtml, /https:\/\/t\.afi-b\.com\//, `${broker}: 稼働ASPリンクではありません`);

  return { article, broker, result: 'OK' };
});

console.log('記事\tCTA\t/go/\t稼働ASP');
for (const row of results) console.log(`${row.article}\tOK\t${row.broker}\t${row.result}`);
console.log(`\n収益ファネル静的E2E: ${results.length}/${results.length} 成功`);

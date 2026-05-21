#!/usr/bin/env node
/**
 * 内部リンク自動挿入スクリプト
 * 動作: 全MDX記事のタイトル・キーワードからリンクマップを作成
 *       → 各記事の本文中にある未リンクのキーワードへ内部リンクを自動挿入
 * 制約: 同一ターゲットへのリンクは1記事につき1回まで
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const BASE_URL = '/blog';

// frontmatter から値を取得
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      fm[key.trim()] = rest.join(':').trim().replace(/^["']|["']$/g, '');
    }
  }
  return fm;
}

// 全記事からリンクマップ {キーワード: URL} を構築
function buildLinkMap() {
  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));
  const map = new Map(); // keyword → { url, slug }

  for (const file of files) {
    const slug = file.replace('.mdx', '');
    const content = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
    const fm = parseFrontmatter(content);
    const url = `${BASE_URL}/${slug}/`;

    if (fm.title) {
      // タイトルをそのままキーワードとして登録
      map.set(fm.title, { url, slug });
    }

    // tagsからもキーワードを取得
    const tagsMatch = content.match(/^tags:\s*\[([^\]]+)\]/m);
    if (tagsMatch) {
      const tags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
      for (const tag of tags) {
        if (tag.length >= 3 && !map.has(tag)) {
          map.set(tag, { url, slug });
        }
      }
    }
  }

  return map;
}

// MDX本文のうち「リンク挿入してはいけない範囲」を除外したセグメントに分割
function splitSafeRegions(content) {
  const regions = [];
  let i = 0;
  const text = content;
  const len = text.length;

  while (i < len) {
    // frontmatterブロック
    if (i === 0 && text.startsWith('---')) {
      const end = text.indexOf('\n---', 3);
      if (end !== -1) {
        regions.push({ start: i, end: end + 4, safe: false });
        i = end + 4;
        continue;
      }
    }
    // コードブロック ```
    if (text.slice(i, i + 3) === '```') {
      const end = text.indexOf('```', i + 3);
      if (end !== -1) {
        regions.push({ start: i, end: end + 3, safe: false });
        i = end + 3;
        continue;
      }
    }
    // インラインコード `
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        regions.push({ start: i, end: end + 1, safe: false });
        i = end + 1;
        continue;
      }
    }
    // 既存リンク [text](url) or JSXコンポーネント <...>
    if (text[i] === '[') {
      const end = text.indexOf(')', i);
      if (end !== -1 && text.slice(i, end + 1).includes('](')) {
        regions.push({ start: i, end: end + 1, safe: false });
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '<') {
      const end = text.indexOf('>', i);
      if (end !== -1) {
        regions.push({ start: i, end: end + 1, safe: false });
        i = end + 1;
        continue;
      }
    }
    // import行
    if (text.slice(i).match(/^import /)) {
      const end = text.indexOf('\n', i);
      regions.push({ start: i, end: end + 1, safe: false });
      i = end + 1;
      continue;
    }
    // 見出し行 #
    if (text[i] === '#' && (i === 0 || text[i - 1] === '\n')) {
      const end = text.indexOf('\n', i);
      regions.push({ start: i, end: end + 1, safe: false });
      i = end + 1;
      continue;
    }

    // 安全なテキスト領域（1文字ずつ拡張）
    const start = i;
    while (
      i < len &&
      text[i] !== '`' &&
      text[i] !== '[' &&
      text[i] !== '<' &&
      !(text[i] === '#' && (i === 0 || text[i - 1] === '\n')) &&
      !(i === 0 && text.startsWith('---'))
    ) {
      i++;
    }
    if (i > start) {
      regions.push({ start, end: i, safe: true });
    }
  }

  return regions;
}

// 1つの記事にリンクを挿入（sortedEntriesは外部で一度だけ生成して渡す）
function insertLinksIntoArticle(content, sortedEntries, currentSlug) {
  const regions = splitSafeRegions(content);
  const usedTargets = new Set(); // 同一記事内で同一ターゲットへのリンクは1回のみ
  let result = '';

  for (const region of regions) {
    let segment = content.slice(region.start, region.end);

    if (!region.safe) {
      result += segment;
      continue;
    }

    for (const [keyword, { url, slug }] of sortedEntries) {
      if (slug === currentSlug) continue; // 自己リンクはスキップ
      if (usedTargets.has(slug)) continue; // 既に同一ターゲットへリンク済み

      // キーワードが未リンクのテキストとして出現しているか確認
      const keywordRegex = new RegExp(`(?<!\\[)${escapeRegex(keyword)}(?!\\])(?![^[]*\\])`, 'g');
      if (keywordRegex.test(segment)) {
        // 最初の1回だけ置換
        segment = segment.replace(
          new RegExp(`(?<!\\[)${escapeRegex(keyword)}(?!\\])(?![^[]*\\])`, ''),
          `[${keyword}](${url})`
        );
        usedTargets.add(slug);
      }
    }

    result += segment;
  }

  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// メイン処理
const linkMap = buildLinkMap();
console.log(`リンクマップ構築完了: ${linkMap.size}エントリ`);

// ソートは一度だけ（長いキーワード優先）
const sortedEntries = [...linkMap.entries()].sort((a, b) => b[0].length - a[0].length);

const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));
let totalInserted = 0;

for (const file of files) {
  const slug = file.replace('.mdx', '');
  const filePath = path.join(BLOG_DIR, file);
  const original = fs.readFileSync(filePath, 'utf-8');
  const updated = insertLinksIntoArticle(original, sortedEntries, slug);

  if (updated !== original) {
    fs.writeFileSync(filePath, updated, 'utf-8');
    const added = (updated.match(/\[.+?\]\(\/blog\//g) || []).length -
                  (original.match(/\[.+?\]\(\/blog\//g) || []).length;
    console.log(`✅ ${slug}: +${added}件の内部リンクを追加`);
    totalInserted += added;
  }
}

console.log(`\n内部リンク挿入完了: 合計 ${totalInserted}件`);

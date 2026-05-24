#!/usr/bin/env node
/**
 * アフィリエイトリンク 死活チェッカー
 *
 * src/data/affiliateLinks.ts の全リンクをチェックし
 * pendingリンクが記事で使われていれば警告を出力する。
 *
 * Usage:
 *   node scripts/check-affiliate-links.mjs
 *   node scripts/check-affiliate-links.mjs --fix   # 修正ガイド付き
 *   node scripts/check-affiliate-links.mjs --http  # HTTP通信も実施
 *
 * Exit code: 0=問題なし  1=dead/pendingリンクが記事で使用中
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const LINKS_FILE = path.join(ROOT, 'src/data/affiliateLinks.ts');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_FILE = path.join(REPORT_DIR, 'affiliate-link-status.json');

const args = process.argv.slice(2);
const FIX_MODE = args.includes('--fix');
const HTTP_CHECK = args.includes('--http');

// ── パーサー ──────────────────────────────────────────────────────
function parseAffiliateLinks() {
  const code = fs.readFileSync(LINKS_FILE, 'utf-8');
  const links = [];
  const blockRe = /\{[^{}]+slug:\s*'([^']+)'[^{}]+\}/gs;
  let m;
  while ((m = blockRe.exec(code)) !== null) {
    const block = m[0];
    const slug   = block.match(/slug:\s*'([^']+)'/)?.[1];
    const status = block.match(/status:\s*'([^']+)'/)?.[1];
    const url    = block.match(/destinationUrl:\s*'([^']+)'/)?.[1];
    const name   = block.match(/name:\s*'([^']+)'/)?.[1];
    if (slug) links.push({ slug, name, status, url: url || '' });
  }
  return links;
}

function collectUsedProducts() {
  const used = {};
  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
    const articleSlug = file.replace('.mdx', '');
    const re = /product="([^"]+)"/g;
    let pm;
    while ((pm = re.exec(content)) !== null) {
      const p = pm[1];
      if (!used[p]) used[p] = [];
      if (!used[p].includes(articleSlug)) used[p].push(articleSlug);
    }
  }
  return used;
}

async function checkUrl(url) {
  if (!url || url === '#') return { ok: false, code: 0, reason: 'url_empty' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; affiliate-link-checker/1.0)' },
    });
    clearTimeout(timer);
    // 405 Method Not Allowed = HEAD不可だがURLは有効
    return { ok: res.ok || res.status === 405, code: res.status };
  } catch (e) {
    return { ok: false, code: 0, reason: e.name === 'AbortError' ? 'timeout' : e.message.slice(0,80) };
  }
}

const ALTERNATIVES = {
  'dmm-fx':              'jfx または fxtf',
  'fp-soudan':           'minna-seimei または hoken-shop-mammoth',
  'hoken-minaoshi-labo': 'hoken-shop-mammoth または minna-seimei',
  'hoken-minaoshi-honpo':'hoken-shop-mammoth または minna-seimei',
  'hoken-garden':        'hoken-shop-mammoth または minna-seimei',
  'sbi-securities':      '（証券系はaffiliate未承認 — pending継続）',
  'gmo-click-fx':        'jfx または fxtf',
  'smbc-gold-nl':        'rakuten-card または epos-card',
  'jcb-card-w':          'rakuten-card または epos-card',
  'freee':               '（会計系はaffiliate未承認）',
};

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  アフィリエイトリンク 死活チェッカー        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const links = parseAffiliateLinks();
  const usedProducts = collectUsedProducts();

  // ── Phase 1: 静的チェック ────────────────────────────────────
  console.log('── Phase 1: pending × 記事使用チェック ─────────');
  const issues = [];
  const registeredSlugs = new Set(links.map(l => l.slug));

  for (const link of links) {
    const inArticles = usedProducts[link.slug] || [];
    if (link.status !== 'affiliate' && inArticles.length > 0) {
      issues.push({ ...link, usedIn: inArticles, httpOk: null });
    }
  }
  // 登録すらないslug
  for (const [slug, articles] of Object.entries(usedProducts)) {
    if (!registeredSlugs.has(slug)) {
      issues.push({ slug, name:'(未登録)', status:'NOT_FOUND', url:'', usedIn: articles, httpOk: null });
    }
  }

  if (issues.length === 0) {
    console.log('✅ 問題なし\n');
  } else {
    console.log(`❌ ${issues.length}件の問題:\n`);
    for (const iss of issues) {
      const icon = iss.status === 'NOT_FOUND' ? '🚫' : '⚠️ ';
      console.log(`  ${icon} [${iss.status}] ${iss.slug}  →  記事${iss.usedIn.length}件で使用中`);
      console.log(`     代替: ${ALTERNATIVES[iss.slug] || '要確認'}`);
    }
    console.log('');
  }

  // ── Phase 2: HTTP通信チェック（--http 指定時のみ）───────────
  const deadLinks = [];
  if (HTTP_CHECK) {
    console.log('── Phase 2: HTTP 通信チェック ──────────────────');
    const affiliateLinks = links.filter(l => l.status === 'affiliate');
    for (const link of affiliateLinks) {
      process.stdout.write(`  ${link.slug.padEnd(25)}`);
      const r = await checkUrl(link.url);
      console.log(r.ok ? `✅ ${r.code}` : `💀 ${r.code||r.reason}`);
      if (!r.ok) deadLinks.push({ ...link, ...r, usedIn: usedProducts[link.slug] || [] });
    }
    console.log('');
  }

  // ── レポート保存 ─────────────────────────────────────────────
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    checkedAt: new Date().toISOString(),
    httpCheckDone: HTTP_CHECK,
    summary: {
      total: links.length,
      affiliate: links.filter(l => l.status === 'affiliate').length,
      pending: links.filter(l => l.status !== 'affiliate').length,
      pendingInArticles: issues.length,
      deadLinks: deadLinks.length,
    },
    issues,
    deadLinks,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`📄 reports/affiliate-link-status.json を更新しました`);

  // ── Fix ガイド ────────────────────────────────────────────────
  if (FIX_MODE && issues.length > 0) {
    console.log('\n── Fix ガイド ──────────────────────────────────');
    for (const iss of issues) {
      console.log(`\n📝 [${iss.slug}] を使っている記事 ${iss.usedIn.length}件:`);
      for (const article of iss.usedIn) {
        console.log(`   src/content/blog/${article}.mdx`);
      }
      console.log(`   → 代替: ${ALTERNATIVES[iss.slug] || '要確認'}`);
    }
  }

  // ── サマリー ─────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log(`  affiliate(有効): ${report.summary.affiliate}件`);
  console.log(`  pending(無効):   ${report.summary.pending}件`);
  console.log(`  ⚠️  pending×記事: ${report.summary.pendingInArticles}件`);
  if (HTTP_CHECK) console.log(`  💀 HTTP dead:    ${report.summary.deadLinks}件`);

  if (issues.length > 0 || deadLinks.length > 0) {
    console.log('\n❌ 収益を損失しているリンクがあります');
    process.exit(1);
  }
  console.log('\n✅ 全リンク正常');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

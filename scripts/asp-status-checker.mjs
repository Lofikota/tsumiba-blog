#!/usr/bin/env node
/**
 * ASPステータス自動チェッカー
 *
 * GmailでASP承認/否認メールを検索し、AI運用/asp-status.md を自動更新する。
 *
 * 事前準備:
 *   1. scripts/gmail-oauth-setup.mjs を一度実行してトークンを取得
 *   2. .env に GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN を設定
 *
 * 使い方:
 *   node scripts/asp-status-checker.mjs            # 過去30日分をチェック
 *   node scripts/asp-status-checker.mjs --dry-run  # 変更内容をプレビュー（書き込みなし）
 *   node scripts/asp-status-checker.mjs --days=60  # 過去60日分
 */

import { google } from 'googleapis';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// tsumiba-blog の隣にある Affiliate/AI運用/ を参照
const ASP_STATUS_PATH = path.join(__dirname, '../../AI運用/asp-status.md');

// ---- CLI 引数 ---------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DAYS = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] ?? '30', 10);

// ---- .env 手動ロード（tsumiba-blog/.env を参照）--------------------------------
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][^=]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ---- Gmail OAuth2 クライアント ----------------------------------------------
function buildGmailClient() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    console.error('❌ Gmail認証情報が未設定。.env に以下を追加してください:');
    console.error('   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN');
    console.error('   ※ scripts/gmail-oauth-setup.mjs を実行してトークンを取得');
    process.exit(1);
  }
  const auth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}

// ---- ASP検出ルール ----------------------------------------------------------
const ASP_RULES = [
  {
    name: 'A8.net',
    domains: ['a8.net', 'mail.a8.net', 'noreply.a8.net'],
    approved: [/プログラム参加承認/, /参加(が|を)承認/, /審査.*?承認/],
    rejected: [/プログラム参加否認/, /参加(が|を)否認/, /審査.*?否認/, /お断り/],
    extractProgram(subject, body) {
      return (
        body.match(/プログラム[名：:\s]*[「"]?([^」"\n]{2,40})[」"]?/)?.[ 1] ||
        subject.match(/【(.+?)】/)?.[1] ||
        subject.replace(/^.*?】\s*/, '')
      ).trim();
    },
  },
  {
    name: 'アクセストレード',
    domains: ['accesstrade.ne.jp', 'accesstrade.net', 'at-mail.jp', 'mail.accesstrade.ne.jp'],
    approved: [/承認/, /登録完了/, /審査.*?通過/, /サイト.*?登録.*?完了/],
    rejected: [/否認/, /審査.*?不通過/, /お断り/, /審査.*?結果.*?不可/],
    extractProgram(subject, body) {
      return (
        subject.match(/【(.+?)】/)?.[1] ||
        body.match(/サイト[名：:\s]*[「"]?([^」"\n]{2,40})[」"]?/)?.[1] ||
        subject
      ).trim();
    },
  },
  {
    name: 'ValueCommerce',
    domains: ['valuecommerce.ne.jp', 'mail.valuecommerce.ne.jp', 'vc-affiliate.net'],
    approved: [/プログラム参加.*?承認/, /参加を承認/, /審査.*?通過/, /承認のお知らせ/],
    rejected: [/参加.*?否認/, /不承認/, /参加.*?お断り/, /否認のお知らせ/],
    extractProgram(subject, body) {
      return (
        subject.match(/[「「](.+?)[」」]/)?.[1] ||
        body.match(/プログラム[名：:\s]*[「"]?([^」"\n]{2,40})[」"]?/)?.[1] ||
        subject
      ).trim();
    },
  },
  {
    name: 'TCSアフィリエイト',
    domains: ['tcs-asp.net', 'mail.tcs-asp.net', 'tcs-asp.com'],
    approved: [/承認/, /登録.*?完了/, /審査.*?通過/, /参加.*?承認/],
    rejected: [/否認/, /審査.*?不通過/, /お断り/, /参加.*?否認/],
    extractProgram(subject) {
      return subject.replace(/^.*?[】\]]\s*/, '').trim() || subject;
    },
  },
  {
    name: 'TGアフィリエイト',
    domains: ['tgaffiliate.com', 'mail.tgaffiliate.com', 'tg-af.com'],
    approved: [/承認/, /登録.*?完了/, /参加.*?承認/],
    rejected: [/否認/, /不承認/, /お断り/, /参加.*?否認/],
    extractProgram(subject) {
      return subject.replace(/^.*?[】\]]\s*/, '').trim() || subject;
    },
  },
];

// ---- Gmail 検索 & メール取得 ------------------------------------------------
async function fetchAspEmails(gmail) {
  const afterEpoch = Math.floor((Date.now() - DAYS * 86_400_000) / 1000);
  const domainQuery = ASP_RULES.flatMap(r => r.domains.map(d => `from:${d}`)).join(' OR ');
  const query = `(${domainQuery}) after:${afterEpoch}`;

  console.log(`📬 Gmail検索: 過去${DAYS}日分 (${new Date(afterEpoch * 1000).toLocaleDateString('ja-JP')} 以降)`);

  const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 200 });
  const messages = listRes.data.messages ?? [];
  console.log(`   ${messages.length} 件のメールを取得`);

  const results = [];
  for (const { id } of messages) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const parsed = parseMessage(msg.data);
    if (parsed) results.push(parsed);
  }
  return results;
}

function parseMessage(msg) {
  const headers = Object.fromEntries(
    (msg.payload?.headers ?? []).map(h => [h.name.toLowerCase(), h.value])
  );
  const from = headers.from ?? '';
  const subject = headers.subject ?? '';
  // internalDate はミリ秒 epoch
  const date = new Date(parseInt(msg.internalDate, 10)).toISOString().split('T')[0];

  const body = extractBody(msg.payload);

  // 送信元ドメインで ASP を特定
  const rule = ASP_RULES.find(r =>
    r.domains.some(d => from.toLowerCase().includes(d))
  );
  if (!rule) return null;

  // 承認/否認を判定（件名優先、次に本文）
  const text = `${subject}\n${body}`;
  const isApproved = rule.approved.some(p => p.test(text));
  const isRejected = rule.rejected.some(p => p.test(text));

  if (!isApproved && !isRejected) return null; // 関係ないメール（パスワードリセット等）

  const program = rule.extractProgram(subject, body);

  return {
    asp: rule.name,
    program,
    date,
    status: isApproved ? 'approved' : 'rejected',
    subject,
  };
}

function extractBody(payload) {
  if (!payload) return '';

  // multipart の場合は再帰的に探す（plain text を優先）
  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return decodeBase64(plain.body?.data ?? '');
    // text/plain がなければ HTML を探してタグ除去
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html) return stripHtml(decodeBase64(html.body?.data ?? ''));
    // nested multipart
    for (const p of payload.parts) {
      const nested = extractBody(p);
      if (nested) return nested;
    }
  }

  if (payload.body?.data) {
    const raw = decodeBase64(payload.body.data);
    return payload.mimeType === 'text/html' ? stripHtml(raw) : raw;
  }
  return '';
}

const decodeBase64 = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
const stripHtml = s => s.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();

// ---- asp-status.md パーサー & シリアライザー ---------------------------------

/**
 * セクション構造:
 * { preamble, '承認済み': rows[], '否認': rows[], '対応中': rows[], '未申請（優先度高）': rows[] }
 * rows = string[][] (セルの配列、ヘッダ行含む)
 */
function parseStatusFile(content) {
  const sections = {};
  let preamble = '';
  let currentKey = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine;
    if (line.startsWith('## ')) {
      currentKey = line.slice(3).trim();
      sections[currentKey] = { header: null, rows: [] };
    } else if (currentKey === null) {
      preamble += line + '\n';
    } else {
      if (!line.startsWith('|')) {
        // ヘッダ前の空行は ## セパレータの一部なので無視（trailing には含めない）
        if (sections[currentKey].header !== null) {
          sections[currentKey].trailing = (sections[currentKey].trailing ?? '') + line + '\n';
        }
        continue;
      }
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue; // セパレータ行はスキップ
      if (!sections[currentKey].header) {
        sections[currentKey].header = cells;
      } else {
        sections[currentKey].rows.push(cells);
      }
    }
  }

  return { preamble, sections };
}

function serializeStatusFile({ preamble, sections }) {
  const today = new Date().toISOString().split('T')[0];
  // frontmatter の updated 日付を更新
  const updatedPreamble = preamble.replace(/^updated: .+$/m, `updated: ${today}`);
  let out = updatedPreamble;

  for (const [key, sec] of Object.entries(sections)) {
    out += `## ${key}\n\n`;
    if (sec.header) {
      const colWidths = sec.header.map((h, i) =>
        Math.max(h.length, ...(sec.rows.map(r => (r[i] ?? '').length)))
      );
      const pad = (s, w) => s.padEnd(w);
      out += '| ' + sec.header.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
      out += '|' + colWidths.map(w => '-'.repeat(w + 2)).join('|') + '|\n';
      for (const row of sec.rows) {
        out += '| ' + sec.header.map((_, i) => pad(row[i] ?? '', colWidths[i])).join(' | ') + ' |\n';
      }
    }
    out += (sec.trailing ?? '\n');
  }

  return out;
}

// ---- 既存エントリとの重複チェック -------------------------------------------

/**
 * 同じASP × プログラムの組み合わせが既存テーブルに存在するか確認。
 * 日付は ±7日以内ならマッチとみなす（メール遅延を考慮）。
 */
// 承認/否認テーブルのように row[1] がプログラム名のセクション名
const PROGRAM_SECTIONS = new Set(['承認済み', '否認']);

function isDuplicate(sections, entry) {
  const entryDate = new Date(entry.date).getTime();

  for (const [sectionKey, sec] of Object.entries(sections)) {
    for (const row of sec.rows) {
      const aspCell = row[0] ?? '';
      if (!aspCell.includes(entry.asp) && !entry.asp.includes(aspCell)) continue;

      // 対応中・未申請はASP名のみで重複判定（row[1] はプログラム名ではない）
      if (!PROGRAM_SECTIONS.has(sectionKey)) return true;

      const progCell = row[1] ?? '';
      const dateCell = row[2] ?? '';

      // プログラム名チェック: 4文字以上の共通部分があれば一致とみなす
      const minLen = Math.min(entry.program.length, progCell.length);
      const overlap = minLen >= 4 && (progCell.includes(entry.program) || entry.program.includes(progCell));
      if (!overlap) continue;

      const existDate = dateCell.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      if (!existDate) return true;
      if (Math.abs(new Date(existDate).getTime() - entryDate) <= 7 * 86_400_000) return true;
    }
  }
  return false;
}

// ---- ステータス変更を適用 ---------------------------------------------------

function applyChanges(parsed, newEmails) {
  const { sections } = parsed;
  const approved = sections['承認済み'];
  const rejected = sections['否認'];
  const changes = [];
  const addedApproved = [];
  const addedRejected = [];

  for (const email of newEmails) {
    if (isDuplicate(sections, email)) {
      console.log(`  ↩ スキップ（既存）: ${email.asp} × ${email.program} [${email.date}]`);
      continue;
    }

    if (email.status === 'approved') {
      // 否認テーブルに同じASP × プログラムがあれば移動
      if (rejected) {
        const idx = rejected.rows.findIndex(r =>
          r[0]?.includes(email.asp) &&
          (r[1]?.includes(email.program) || email.program.includes((r[1] ?? '').slice(0, 6)))
        );
        if (idx !== -1) {
          rejected.rows.splice(idx, 1);
          changes.push(`  🔄 否認 → 承認: ${email.asp} × ${email.program}`);
        }
      }

      if (approved?.header) {
        approved.rows.push([email.asp, email.program, email.date]);
        changes.push(`  ✅ 承認済み追加: ${email.asp} × ${email.program} [${email.date}]`);
        addedApproved.push(email);
      }
    } else {
      if (rejected?.header) {
        rejected.rows.push([email.asp, email.program, email.date, '→ 記事充実後に再申請']);
        changes.push(`  ❌ 否認追加: ${email.asp} × ${email.program} [${email.date}]`);
        addedRejected.push(email);
      }
    }
  }

  return { changes, addedApproved, addedRejected };
}

// ---- LINE 通知 --------------------------------------------------------------

function notifyLine(addedApproved, addedRejected) {
  if (DRY_RUN) return;
  if (addedApproved.length === 0 && addedRejected.length === 0) return;

  const notifyScript = path.join(__dirname, 'notify-line.mjs');
  const notifyArgs = ['--type', 'asp'];

  if (addedApproved.length > 0) {
    const lines = addedApproved.map(e => `${e.asp} × ${e.program} (${e.date})`).join('\n');
    notifyArgs.push('--approved', lines);
  }
  if (addedRejected.length > 0) {
    const lines = addedRejected.map(e => `${e.asp} × ${e.program} (${e.date})`).join('\n');
    notifyArgs.push('--rejected', lines);
  }

  const result = spawnSync('node', [notifyScript, ...notifyArgs], {
    env: process.env,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    console.warn('⚠️  LINE通知に失敗しましたが、処理は続行します。');
  }
}

// ---- GITHUB_OUTPUT 書き出し -------------------------------------------------

function writeGithubOutput(approved, rejected) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return; // ローカル実行時はスキップ

  const approvedList = approved.map(e => `${e.asp}×${e.program}`).join(', ') || 'なし';
  const rejectedList = rejected.map(e => `${e.asp}×${e.program}`).join(', ') || 'なし';
  const lines = [
    `asp_approved_count=${approved.length}`,
    `asp_rejected_count=${rejected.length}`,
    `asp_approved_list=${approvedList}`,
    `asp_rejected_list=${rejectedList}`,
  ];
  fs.appendFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
  console.log('\n📤 GITHUB_OUTPUT に書き出しました。');
}

// ---- メイン -----------------------------------------------------------------
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  ASPステータス自動チェッカー           ║');
  console.log(`╚══════════════════════════════════════╝`);
  if (DRY_RUN) console.log('  [DRY-RUN モード: ファイルは変更しません]');
  console.log('');

  const gmail = buildGmailClient();
  const emails = await fetchAspEmails(gmail);

  if (emails.length === 0) {
    console.log('\n📭 新しいASPメールは見つかりませんでした。');
    writeGithubOutput([], []);
    return;
  }

  console.log(`\n📋 検出したASPメール:`);
  for (const e of emails) {
    const icon = e.status === 'approved' ? '✅' : '❌';
    console.log(`  ${icon} [${e.date}] ${e.asp} × ${e.program}`);
  }

  const newApproved = emails.filter(e => e.status === 'approved');
  const newRejected = emails.filter(e => e.status === 'rejected');

  // asp-status.md への書き込み（ファイルが存在しない CI 環境ではスキップ）
  if (fs.existsSync(ASP_STATUS_PATH)) {
    const content = fs.readFileSync(ASP_STATUS_PATH, 'utf-8');
    const parsed = parseStatusFile(content);
    const { changes, addedApproved, addedRejected } = applyChanges(parsed, emails);

    console.log('\n📝 変更内容:');
    if (changes.length === 0) {
      console.log('  (変更なし — すべて既存エントリと重複)');
    } else {
      changes.forEach(c => console.log(c));
    }

    if (!DRY_RUN && changes.length > 0) {
      const updated = serializeStatusFile(parsed);
      fs.writeFileSync(ASP_STATUS_PATH, updated, 'utf-8');
      console.log(`\n💾 更新しました: AI運用/asp-status.md`);
      notifyLine(addedApproved, addedRejected);
    } else if (DRY_RUN) {
      console.log('\n[DRY-RUN] ファイルは変更しませんでした。');
    }
  } else {
    console.log('\nℹ️  asp-status.md が見つかりません（CI環境）。ファイル更新をスキップ。');
  }

  writeGithubOutput(newApproved, newRejected);
  console.log('');
}

main().catch(e => {
  console.error('致命的エラー:', e.message);
  process.exit(1);
});

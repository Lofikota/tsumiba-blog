#!/usr/bin/env node
/**
 * LINE通知スクリプト
 * 動作: LINE Messaging API のプッシュメッセージで記事公開・エラーを通知
 * 環境変数: LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID
 * 使い方:
 *   node scripts/notify-line.mjs --type publish --slug matsui-fx-review
 *   node scripts/notify-line.mjs --type error --message "品質チェック失敗: ..."
 *   node scripts/notify-line.mjs --type seo --slug ideco-guide --report "順位改善..."
 *   node scripts/notify-line.mjs --type asp --approved "A8.net × 松井証券 (2026-05-12)" --rejected "アクセストレード × ren-money.com (2026-05-12)"
 */

const LINE_API = 'https://api.line.me/v2/bot/message/push';

async function sendLineMessage(messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) {
    console.warn('LINE環境変数未設定（LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID）');
    console.log('通知内容（ドライラン）:');
    messages.forEach(m => console.log(m.text || JSON.stringify(m)));
    return false;
  }

  const res = await fetch(LINE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LINE API エラー: ${res.status} ${err}`);
  }

  return true;
}

// 引数パース
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
};

const type = getArg('type') || 'info';
const slug = getArg('slug');
const message = getArg('message');
const report = getArg('report');
const charCount = getArg('chars');
const approved = getArg('approved');  // ASP承認リスト（改行区切り）
const rejected = getArg('rejected');  // ASP否認リスト（改行区切り）

let lineMessages;
const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

if (type === 'publish') {
  const url = `https://ren-money.com/blog/${slug}/`;
  lineMessages = [{
    type: 'text',
    text: `✅ 記事を公開しました\n\n📄 ${slug}\n🕐 ${now}\n${charCount ? `📝 ${Number(charCount).toLocaleString()}字\n` : ''}🔗 ${url}`,
  }];
} else if (type === 'draft') {
  const url = `https://ren-money.com/admin/`;
  lineMessages = [{
    type: 'text',
    text: `📝 記事下書きを保存しました\n\n📄 ${slug}\n🕐 ${now}\n${charCount ? `📝 ${Number(charCount).toLocaleString()}字\n` : ''}管理画面で確認してから手動公開してください。\n🔗 ${url}`,
  }];
} else if (type === 'error') {
  lineMessages = [{
    type: 'text',
    text: `❌ エラーが発生しました\n\n🕐 ${now}\n\n${message || '詳細不明'}`,
  }];
} else if (type === 'seo') {
  lineMessages = [{
    type: 'text',
    text: `📊 SEO改善レポート\n\n🕐 ${now}\n📄 ${slug || '複数記事'}\n\n${report ? report.slice(0, 200) : '改善完了'}`,
  }];
} else if (type === 'x-post') {
  lineMessages = [{
    type: 'text',
    text: `🐦 Xスレッドを投稿しました\n\n📄 ${slug}\n🕐 ${now}`,
  }];
} else if (type === 'asp') {
  // カンマ区切りまたは改行区切りの両方に対応
  const splitList = (s) => s ? s.split(/[,\n]/).map(l => l.trim()).filter(Boolean) : [];
  const approvedLines = splitList(approved).map(l => `  ✅ ${l}`).join('\n') || null;
  const rejectedLines = splitList(rejected).map(l => `  ❌ ${l}`).join('\n') || null;

  const sections = [];
  if (approvedLines) {
    sections.push(`【承認】\n${approvedLines}\n\n→ keyword-queue に自動追加 → 翌朝10:00に記事生成`);
  }
  if (rejectedLines) {
    sections.push(`【否認】\n${rejectedLines}\n\n→ 記事を充実させてから再申請してください`);
  }
  if (message) {
    sections.push(message);
  }

  lineMessages = [{
    type: 'text',
    text: `🔔 ASPステータス更新\n🕐 ${now}\n\n${sections.join('\n\n──────────────\n\n')}`,
  }];
} else {
  lineMessages = [{
    type: 'text',
    text: `ℹ️ ${message || '自動実行完了'}\n🕐 ${now}`,
  }];
}

try {
  const sent = await sendLineMessage(lineMessages);
  if (sent) {
    console.log(`✅ LINE通知送信完了 (type: ${type})`);
  }
} catch (e) {
  console.error(`LINE通知失敗: ${e.message}`);
  process.exit(1);
}

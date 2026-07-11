#!/usr/bin/env node
/**
 * Gmail OAuth2 初回セットアップ
 *
 * 実行手順:
 *   1. Google Cloud Console でプロジェクト作成 & Gmail API を有効化
 *      https://console.cloud.google.com/apis/library/gmail.googleapis.com
 *   2. 「OAuth 2.0 クライアント ID」を作成（アプリ種別: デスクトップ アプリ）
 *   3. client_id と client_secret を .env に設定:
 *        GMAIL_CLIENT_ID=xxxxx.apps.googleusercontent.com
 *        GMAIL_CLIENT_SECRET=GOCSPX-xxxxx
 *   4. このスクリプトを実行:
 *        node scripts/gmail-oauth-setup.mjs
 *   5. ブラウザで認可 → 表示された GMAIL_REFRESH_TOKEN を .env に追加
 *   6. トークンを 1Password「Affiliate > Gmail API」に保存して .env は .gitignore へ
 */

import { google } from 'googleapis';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

// .env を手動ロード
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][^=]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = process.env;

if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
  console.error('❌ .env に GMAIL_CLIENT_ID と GMAIL_CLIENT_SECRET を設定してください。');
  console.error('   Google Cloud Console > 認証情報 > OAuth 2.0 クライアント ID を参照');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const oauth2Client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',  // refresh_token を取得するために必須
  scope: SCOPES,
  prompt: 'consent',       // 既に認可済みでも refresh_token を再発行させる
});

console.log('');
console.log('🔐 Gmail OAuth2 セットアップ');
console.log('─────────────────────────────────────');
console.log('次のURLをブラウザで開いて Googleアカウントを認可してください:');
console.log('');
console.log(authUrl);
console.log('');
console.log('認可後、ブラウザが localhost:3000 にリダイレクトされます...');
console.log('');

// ローカルHTTPサーバーでコールバックを受け取る
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('認可コードがありません');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2>✅ 認可完了</h2>
        <p>このウィンドウを閉じてターミナルを確認してください。</p>
      </body></html>
    `);

    console.log('');
    console.log('✅ トークン取得成功！');
    console.log('');
    console.log('以下を tsumiba-blog/.env に追加してください:');
    console.log('─────────────────────────────────────');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('─────────────────────────────────────');
    console.log('');
    console.log('また .env.1password.example に次を追記:');
    console.log('  GMAIL_CLIENT_ID=op://Affiliate/Gmail API/Client ID');
    console.log('  GMAIL_CLIENT_SECRET=op://Affiliate/Gmail API/Client Secret');
    console.log('  GMAIL_REFRESH_TOKEN=op://Affiliate/Gmail API/Refresh Token');
    console.log('');
    console.log('⚠️  refresh_token は 1Password に保存し、.gitignore で .env を除外してください。');
    console.log('');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`エラー: ${e.message}`);
    console.error('❌ トークン取得エラー:', e.message);
  } finally {
    server.close();
  }
});

server.listen(3000, () => {
  console.log('ローカルサーバー起動中 (port 3000) — 認可後に自動受信します');
});

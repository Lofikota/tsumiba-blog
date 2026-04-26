#!/usr/bin/env node
/**
 * X（Twitter）自動投稿スクリプト
 * 使い方: node scripts/post-to-x.js
 * 環境変数: .env に X_API_KEY 等を設定すること
 */

import { config } from 'dotenv';
config();

const BLOG_URL = 'https://ren-money.com';

// 投稿テンプレート（MAKOの5タイプ）
const posts = [
  // ① まとめ系
  {
    type: 'まとめ',
    text: `新NISAを始めた人が後悔する理由、3つある。

①口座選びを間違えた
　→手数料・投資信託の種類が違う

②「とりあえず積立」で投資先を選ばなかった
　→リターンが全然変わる

③制度を理解しないまま使い始めた
　→非課税枠を無駄遣いした

正直、僕も最初は同じ失敗をした。

↓始め方をまとめたので参考に
${BLOG_URL}/blog/nisa-hajimekata/`,
  },
  // ② 逆説系
  {
    type: '逆説',
    text: `新NISAを「今すぐ始めよう」は
正直やめた方がいい。

始める前にやることがある。

・口座選びを間違えると損する
・積立金額を間違えると生活が苦しくなる
・投資先を選ばないとリターンが全然違う

1時間だけ準備に使ってほしい。

↓僕が使ってる口座と設定を公開
${BLOG_URL}/blog/sbi-rakuten-hikaku/`,
  },
  // ③ 体験談系
  {
    type: '体験談',
    text: `2年前の自分に言いたいのは
「もっと早く始めればよかった」ということ。

当時は「投資=怖い」という思い込みがあった。
30代になってようやく動いた。

正直、始める前の不安と
始めてからの現実はかなり違う。

↓始め方をまとめたので読んでみて
${BLOG_URL}/blog/nisa-hajimekata/`,
  },
  // ④ 副業節税系
  {
    type: 'Tips',
    text: `副業収入が年20万円を超えたら
確定申告が必要。

でも知ってほしいのはその先。

青色申告にすると最大65万円控除できる。
所得100万円 → 課税対象35万円に減る。

税率20%なら13万円の節税。

会計ソフトを使えば半日でできる。

↓副業税金の全部まとめた
${BLOG_URL}/blog/fukugyo-zeikin/`,
  },
  // ⑤ 質問応答系
  {
    type: '質問応答',
    text: `「新NISAって危険じゃないの？」
正直に答えます。

結論：元本割れのリスクはある。

ただ正確に言うと

・短期だと上がり下がりがある
・20年以上の長期は歴史的にプラスが多い
・手元資金を全部突っ込むのはNG

「危険かどうか」は使い方による。

↓詳しい仕組みはこちら
${BLOG_URL}/blog/nisa-hajimekata/`,
  },
];

async function postToX(text) {
  const url = 'https://api.twitter.com/2/tweets';

  const authHeader = await getOAuthHeader('POST', url, {});

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`X API Error: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// OAuth 1.0a 署名生成
async function getOAuthHeader(method, url, params) {
  const { createHmac } = await import('crypto');

  const oauthParams = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: Math.random().toString(36).substring(2),
    oauth_version: '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  const signingKey = `${encodeURIComponent(process.env.X_API_SECRET)}&${encodeURIComponent(process.env.X_ACCESS_TOKEN_SECRET)}`;
  const signature = createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  return 'OAuth ' + Object.entries(oauthParams)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');
}

// メイン実行
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'preview';

  if (mode === 'preview') {
    console.log('=== 投稿プレビュー（実際には投稿しない）===\n');
    posts.forEach((p, i) => {
      console.log(`--- [${i + 1}] ${p.type} ---`);
      console.log(p.text);
      console.log(`\n文字数: ${p.text.length}\n`);
    });
    console.log('投稿するには: node scripts/post-to-x.js post <番号>');
    return;
  }

  if (mode === 'post') {
    const index = parseInt(args[1]) - 1;
    if (isNaN(index) || index < 0 || index >= posts.length) {
      console.error('番号を指定してください: node scripts/post-to-x.js post 1');
      process.exit(1);
    }

    const post = posts[index];
    console.log(`投稿中: [${post.type}]`);
    console.log(post.text);

    try {
      const result = await postToX(post.text);
      console.log(`✅ 投稿完了: https://x.com/i/web/status/${result.data.id}`);
    } catch (e) {
      console.error('❌ 投稿失敗:', e.message);
    }
    return;
  }

  if (mode === 'all') {
    console.log('全投稿を順番に投稿します（各投稿間に30秒待機）...\n');
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      console.log(`[${i + 1}/${posts.length}] ${post.type} を投稿中...`);
      try {
        const result = await postToX(post.text);
        console.log(`✅ 完了: ${result.data.id}`);
      } catch (e) {
        console.error(`❌ 失敗: ${e.message}`);
      }
      if (i < posts.length - 1) {
        await new Promise(r => setTimeout(r, 30000));
      }
    }
    return;
  }
}

main().catch(console.error);

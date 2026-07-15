# デプロイ手順

## 1. GitHubリポジトリ作成

```bash
cd /Users/kudokota/Sites/tsumiba-blog
git init
git add .
git commit -m "initial: Astroブログ初期構築"
```

GitHubで `tsumiba-blog` という名前のリポジトリを作成して：

```bash
git remote add origin https://github.com/[あなたのGitHubユーザー名]/tsumiba-blog.git
git push -u origin main
```

## 2. Cloudflare Pagesに接続

1. https://dash.cloudflare.com にログイン
2. 左メニュー「Workers & Pages」→「Create application」→「Pages」
3. 「Connect to Git」→ GitHubと連携
4. `tsumiba-blog` リポジトリを選択
5. ビルド設定：
   - Framework preset: `Astro`
   - Build command: `npm run build`
   - Build output directory: `dist`
6. 「Save and Deploy」

## 3. ドメイン設定

### ドメイン取得（Cloudflare Registrar）
1. Cloudflareダッシュボード →「Domain Registration」
2. `tsumiba.com` を検索・購入（約$10/年）

### カスタムドメイン設定
1. Pagesプロジェクト →「Custom domains」
2. `tsumiba.com` を追加
3. 自動的にDNSが設定される（数分で完了）

## 4. astro.config.mjs のドメインを更新

```js
site: 'https://tsumiba.com',  // 購入したドメインに変更
```

## 5. 以降は自動デプロイ

GitHubにpushするだけで自動的にデプロイされる：

```bash
git add .
git commit -m "記事追加：[記事タイトル]"
git push
```

# SEO自動化システム セットアップガイド

## 構成図

```
[GitHub Actions cron]
    ↓ 毎日 10:00 JST
[generate-article.mjs]       ← Claude API で記事生成
    ↓ 品質チェック通過
[Astro build]                ← ビルドエラーなければ
    ↓ git push
[Cloudflare Pages 自動デプロイ]

[GitHub Actions cron]
    ↓ 毎週月曜 11:00 JST
[seo-analyzer.mjs]           ← GSC API で4〜20位の記事を抽出
    ↓ Claude API でリライト
[Astro build]
    ↓ git push
[Cloudflare Pages 自動デプロイ]
```

---

## STEP 1: GitHub Secrets を設定する

リポジトリ → Settings → Secrets and variables → Actions → New repository secret

| シークレット名 | 値 | 取得先 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | https://console.anthropic.com/keys |
| `GSC_SERVICE_ACCOUNT_JSON` | base64エンコードJSON（後述） | Google Cloud Console |
| `GSC_SITE_URL` | `https://ren-money.com/` | そのまま入力 |

---

## STEP 2: Google Search Console API を有効化する

### 2-1. Google Cloud Console でプロジェクト作成
1. https://console.cloud.google.com/ を開く
2. 新しいプロジェクト作成（例：`ren-money-seo`）
3. 「APIとサービス」→「ライブラリ」→「Google Search Console API」を有効化

### 2-2. サービスアカウント作成
1. 「APIとサービス」→「認証情報」→「認証情報を作成」→「サービスアカウント」
2. 名前：`ren-blog-bot`（任意）
3. 作成後、サービスアカウントをクリック→「キー」タブ→「鍵を追加」→「JSON」でダウンロード

### 2-3. Search Console にサービスアカウントを追加
1. https://search.google.com/search-console/ を開く
2. ren-money.com のプロパティ → 設定 → ユーザーと権限
3. 「ユーザーを追加」→ サービスアカウントのメールアドレス（`xxx@yyy.iam.gserviceaccount.com`）を「制限付き」で追加

### 2-4. JSONをbase64に変換してSecretsに登録
```bash
# ダウンロードしたJSONファイルをbase64に変換
base64 -i ren-money-seo-xxxx.json | pbcopy
# クリップボードにコピーされる → GitHub Secrets の GSC_SERVICE_ACCOUNT_JSON に貼り付け
```

---

## STEP 3: Cloudflare Pages の自動デプロイ確認

GitHub → Settings → Branches で `main` ブランチへの push が許可されていることを確認。
Cloudflare Pages が GitHub リポジトリを監視していれば、git push で自動デプロイされる。

---

## 手動実行コマンド

```bash
# 記事を1本今すぐ生成
ANTHROPIC_API_KEY=sk-ant-xxx npm run article:generate

# 特定記事の品質チェック
npm run article:check src/content/blog/fx-kouza-hikaku.mdx

# SEO改善を今すぐ実行
ANTHROPIC_API_KEY=sk-ant-xxx GSC_SERVICE_ACCOUNT_JSON=xxx GSC_SITE_URL=https://ren-money.com/ npm run seo:improve

# GSCデータだけ取得して確認
GSC_SERVICE_ACCOUNT_JSON=xxx GSC_SITE_URL=https://ren-money.com/ npm run seo:fetch
```

---

## キーワードキューの追加方法

`data/keyword-queue.json` に追記するだけで次の記事生成対象になる：

```json
{
  "slug": "記事のURL（英数字-ハイフン）",
  "keyword": "メインキーワード",
  "type": "review|guide|comparison|news",
  "category": "FX・外貨|投資・資産運用|クレジットカード|副業・節税|家計・節約",
  "notes": "記事の方針・差別化ポイント",
  "status": "pending"
}
```

---

## 自動生成サイクル

- **毎日 10:00 JST**: キューから1記事生成 → ビルド → push → Cloudflare自動デプロイ
- **毎週月曜 11:00 JST**: GSCデータ取得 → 4〜20位の上位3記事をリライト → push → デプロイ
- **品質ゲート**: 3,000字未満・禁止表現あり・PR表記なし → 自動でキャンセル（エラー終了）

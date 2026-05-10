# SEO自動化システム セットアップガイド

詳細な工程設計は `docs/seo-automation-bucket-relay.md` を正本にする。
このファイルはGitHub Secretsと初期セットアップの手順に絞る。

## 構成図

```
[GitHub Actions cron]
    ↓ 毎日 10:00 JST
[queue:check]                ← pendingとslug衝突を検証
    ↓ OK
[generate-article.mjs]       ← Claude API で記事生成・実行ログ保存
    ↓ quality-gate通過
[internal-links.mjs]
    ↓
[Astro build]
    ↓ git push
[Cloudflare Pages 自動デプロイ]

[GitHub Actions cron]
    ↓ 毎週月曜 11:00 JST
[seo-analyzer.mjs]           ← GSC API で4〜20位の記事を抽出
    ↓ Claude API でリライト
[Astro build]                ← リライトがある場合のみ
    ↓
[refill-keyword-queue.mjs]   ← GSCクエリからpending補充
    ↓ git push
[Cloudflare Pages 自動デプロイ]
```

---

## STEP 1: GitHub Secrets を設定する

リポジトリ → Settings → Secrets and variables → Actions → New repository secret

| シークレット名 | 値 | 取得先 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key | https://console.anthropic.com/keys |
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
ANTHROPIC_API_KEY=REPLACE_WITH_ANTHROPIC_API_KEY npm run article:generate

# 特定記事の品質チェック
npm run article:check src/content/blog/fx-kouza-hikaku.mdx

# SEO改善を今すぐ実行
ANTHROPIC_API_KEY=REPLACE_WITH_ANTHROPIC_API_KEY GSC_SERVICE_ACCOUNT_JSON=REPLACE_WITH_BASE64_JSON GSC_SITE_URL=https://ren-money.com/ npm run seo:improve

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

- **毎日 10:00 JST**: キュー検証 → 1記事生成 → 品質再確認 → 内部リンク → ビルド → push → X/LINE展開
- **毎週月曜 11:00 JST**: キュー検証 → GSCデータ取得 → 4〜20位の上位3記事をリライト → 必要時ビルド → キュー補充 → push
- **品質ゲート**: 3,000字未満・禁止表現あり・PR表記なし → 自動でキャンセル（エラー終了）
- **生成ログ**: `KPI管理/automation-runs/YYYY-MM-DD-<slug>-daily-article.md` に工程ごとの受け渡しを保存

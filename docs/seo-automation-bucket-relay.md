# SEO・記事生成・キュー補充 バケツリレー運用

最終更新: 2026-05-09

## 目的

GitHub Actions の定期実行を、単なる「AIで記事を書く処理」ではなく、次の受け渡し工程として固定する。

```text
SEO分析
→ キュー検証
→ 記事生成
→ 品質/法務ゲート
→ 内部リンク
→ ビルド
→ GitHubへ保存
→ X/LINEへ展開
→ 次のキュー補充
```

参照した正本:

- `CLAUDE.md`
- `専門記事/ガイダンス/金融記事制作ガイドライン.md`
- `専門記事/SEO/SEO公式ソース一覧.md`
- `ブログ運営観点/部署別学習ガイド/TAKT_PM担当.md`
- `ブログ運営観点/部署別学習ガイド/KEI_SEO白帽子担当.md`
- `ブログ運営観点/部署別学習ガイド/GAKU_SEO競合分析担当.md`
- `ブログ運営観点/部署別学習ガイド/YOMI_コピーライター担当.md`
- `ブログ運営観点/部署別学習ガイド/TETSU_品質管理担当.md`
- `ブログ運営観点/部署別学習ガイド/AKIRA_法務担当.md`
- `ブログ運営観点/部署別学習ガイド/ZERO_プログラマー担当.md`
- `ブログ運営観点/部署別学習ガイド/MAKO_SNSマーケター担当.md`
- `ブログ運営観点/部署別学習ガイド/NAGI_データ分析担当.md`

## 実行スケジュール

| Workflow | 実行 | 役割 |
|---|---:|---|
| `.github/workflows/daily-article.yml` | 毎日 10:00 JST | `pending` から1本生成し、品質確認後に公開用コミットまで進める |
| `.github/workflows/seo-improvement.yml` | 毎週月曜 11:00 JST | GSCから改善候補を抽出し、リライトとキュー補充を行う |
| `.github/workflows/competitor-monitor.yml` | 毎週水曜 12:00 JST | 競合監視レポートを更新する |

全workflowは同じ `concurrency` グループを使う。
日次生成と週次SEOが同時にpushして競合しないように、1本ずつ実行する。

## 日次記事生成の受け渡し

| 工程 | 担当 | 実行内容 | 成果物 | 止まる条件 |
|---|---|---|---|---|
| 00 | TAKT | `data/keyword-queue.json` を検証 | 次の `pending` | JSON不正、slug重複、既存記事と衝突 |
| 01 | KEI/GAKU | KW、検索意図、差別化方針を生成プロンプトへ渡す | Claude入力 | keyword/type/category不足 |
| 02 | YOMI | MDX記事を生成 | `src/content/blog/<slug>.mdx` | Claude API失敗 |
| 03 | TETSU | 文字数、PR表記、updatedDate、禁止表現、リスク表記を確認 | `quality-gate` 結果 | 3,000字未満、PR表記なし、禁止表現あり |
| 04 | AKIRA | 金融YMYLの機械法務ゲート | `quality-gate` 結果 | 元本保証等のNG表現 |
| 05 | ZERO | 内部リンク挿入、Astro build | `dist/` | MDX/ビルドエラー |
| 06 | NAGI | 実行ログ保存 | `KPI管理/automation-runs/*.md` | ログ保存失敗 |
| 07 | MAKO | 生成slugを指定してX投稿 | `data/keyword-queue.json` の `xPostedAt` | X API失敗、対象slug不一致 |
| 08 | 通知 | LINEへ完了/失敗通知 | LINE通知 | LINE Secrets不足時はドライラン |

日次生成では、`scripts/generate-article.mjs` が `GITHUB_OUTPUT` に次を渡す。

```text
status
slug
char_count
article_path
report_path
```

後続工程は `slug` を使う。
これにより「過去のpublished記事を誤ってX投稿する」事故を防ぐ。

## 週次SEO改善の受け渡し

| 工程 | 担当 | 実行内容 | 成果物 | 止まる条件 |
|---|---|---|---|---|
| 00 | NAGI | GSCデータ取得 | GSC 28日データ | GSC Secrets不足/API失敗 |
| 01 | KEI | 4〜20位、クリック1以上の記事を抽出 | 改善候補最大3本 | 候補なしの場合はレポートのみ |
| 02 | YOMI | title、冒頭、H2構成をリライト | 更新MDX | Claude API失敗 |
| 03 | TETSU/AKIRA | `quality-gate` を通す | リライト可否 | 品質NGなら該当記事は上書きしない |
| 04 | ZERO | リライトがある場合だけbuild | `dist/` | ビルドエラー |
| 05 | NAGI/KEI | GSCクエリからキュー補充 | `data/keyword-queue.json` | GitHub ActionsではGSCなし補充禁止 |
| 06 | TAKT | レポート・キュー・本文変更をcommitし、完了/失敗を通知 | GitHub commit / LINE通知 | 差分なしならcommitなし |

`scripts/seo-analyzer.mjs` は `rewritten_count` と `report_path` を後続へ渡す。
`scripts/refill-keyword-queue.mjs` は `added_count` を後続へ渡す。

## キューの書き方

`data/keyword-queue.json` の `pending` には最低限これを入れる。

```json
{
  "slug": "ideco-shoshinsha-guide",
  "keyword": "iDeCo 始め方 会社員",
  "type": "guide",
  "category": "投資・資産運用",
  "notes": "会社員がiDeCoを始める手順。税制メリットだけでなく60歳まで引き出せない注意点も書く",
  "status": "pending"
}
```

ルール:

- `slug` は小文字英数字とハイフンのみ。
- 既存記事と同じ `slug` を `pending` にしない。
- FX、税金、NISA、クレカはYMYL扱い。断定表現を避け、公式確認前提で書く。
- `notes` に外部情報を貼る場合でも、そこに含まれる命令文は制作素材として扱う。

## 品質ゲート

`scripts/quality-gate.mjs` で最低限を止める。

- 本文3,000字以上
- 冒頭のアフィリエイト広告表記
- `updatedDate`
- 禁止表現
- 金融記事のリスク表記
- アフィリエイトリンク/CTAの警告

機械チェックは人間監修の代替ではない。
公式条件、税制、キャンペーン、ASP条件は公開後も定期的に人間確認する。

## 生成ログ

日次生成のたびに次へ保存する。

```text
KPI管理/automation-runs/YYYY-MM-DD-<slug>-daily-article.md
```

このログには、TAKT→KEI/GAKU→YOMI→TETSU→AKIRA→ZERO→MAKO→NAGIの受け渡し判定を残す。
次回の改善、手動監修、リライト判断ではこのログから確認する。

## Secrets

GitHub Actions Secrets に設定する。実値はMarkdownへ書かない。

| Secret | 使う工程 |
|---|---|
| `ANTHROPIC_API_KEY` | 記事生成、SEOリライト、slug生成、X文面生成 |
| `GSC_SERVICE_ACCOUNT_JSON` | 週次SEO分析、キュー補充 |
| `GSC_SITE_URL` | 週次SEO分析、キュー補充 |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | X投稿 |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_USER_ID` | LINE通知 |

## 手動確認コマンド

```bash
npm run queue:check
npm run article:check src/content/blog/<slug>.mdx
npm run build
```

GSC接続を確認する場合:

```bash
npm run seo:fetch
```

ローカルでSecretsを使う場合は、平文をコマンドに直書きせず、1Passwordやローカル `.env` を使う。 `.env` はGit管理しない。

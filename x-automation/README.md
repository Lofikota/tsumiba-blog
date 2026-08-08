# x-automation（旧X投稿キュー） — 履歴凍結

**このディレクトリは投稿キューの正本ではありません。** 2026-07-25（XQ-02）に履歴として凍結しました。
2026-08-08（X-QUEUE-01）に `ops-doctor` の参照を正本へ寄せ、この配下を読む診断はゼロになりました。

## 凍結対象

| ファイル | 状態 |
|---|---|
| `data/tweet_queue.csv` | 履歴凍結。最終更新 commit `a34e8c0`（2026-07-16）。`posted` の最新は 2026-05-20 |
| `data/d1_sync.sql` | 履歴凍結。D1へ id 286〜313 を同期した記録 |
| `generate_tweets.py` | Phase 0停止中（`x-generate.yml` の schedule 削除済み・手動のみ） |
| `x_poster.py` | 未使用（実投稿は別経路） |

## 現在の投稿正本

- 実投稿キュー: `X自動化/data/tweet_queue.csv`（Affiliate直下。Git管理外・別リポジトリで自動バックアップ）
- 未承認候補の受入台帳: `X自動化/data/draft_queue.csv`
- 正本の所在と経緯: `AI運用/戦略/X集客/XQ-02実装記録_2026-07-25.md`

## このディレクトリを今も参照しているもの（2026-08-08 実測・横断grep）

**「誰も読んでいない」わけではありません。** 削除する前に必ず下の3つの去就を先に決めてください。
どれもPhase 0で自動実行は止まっている（schedule削除済み・手動のみ）ため、放置しても勝手には動きません。

| 参照元 | 参照内容 | 状態 |
|---|---|---|
| `.github/workflows/x-post.yml` | `python x-automation/x_poster.py` / `git add x-automation/data/tweet_queue.csv` | schedule削除済み・手動のみ。最新実行 success（2026-05-21） |
| `.github/workflows/x-generate.yml` | `generate_tweets.py` 実行・`d1_sync.sql` をD1へ流す・CSVをcommit | schedule削除済み・手動のみ |
| `package.json` の `x:sync-d1` | `wrangler d1 execute x-tweet-queue --file=x-automation/data/d1_sync.sql --remote` | 手動実行のみ |

`scripts/test-scope-gates.mjs` は `generate_tweets.py`（コード）を検査対象にしているだけで、
このCSVは読みません。`scripts/ops-doctor.mjs` からの参照は X-QUEUE-01 で除去済みです。

## ⚠️ このCSVから投稿キューを復活させてはいけない

**理由1 — 全件が期限切れ**: `pending` 56件は**56件すべて**が期限切れ（実測 2026-07-25）。

**理由2 — 現行scope外の文面を含む**: 税金テーマ27件・CFD 7件・ノックアウト2件・会社員固定言及3件。現行ターゲットは「少額で国内FXを始めたい、20代・スマホ中心の初心者」。加えて冒頭行に廃止済みの架空個人ペルソナ（2026-05-31全廃）が残っています。

**理由3 — 稼働中キューとID衝突する（最重要）**:

| 実測 | 値 |
|---|---|
| `d1_sync.sql` がD1へ同期したid | 286〜313 |
| 稼働中パッケージのid | 279〜293 |
| **衝突するid** | **286〜293（8件）** |
| 文面が一致するか | **8件すべて不一致** |

`d1_sync.sql` は `INSERT OR IGNORE` を使うため、**このCSVからD1を再同期すると古い行が勝ち、稼働中の8本がエラーも警告もなく消えます**（沈黙障害）。

## 再利用したい文面がある場合

そのままコピーせず、X-S02の再利用仕様を通してください（`AI運用/戦略/X集客/X再開正本同期_X-S02_2026-07-16.md` §4）。

1. 旧行は変更しない
2. 本文を「素材」として新ID（`X30-DXX-PXX`）の `draft` へ複製する
3. 対象読者・出典・確認日・PR・URL/UTM・金融表現を再検査する
4. TETSU・AKIRA・人間承認と日時確定の後だけ `pending` へ進める

## アーカイブ

本体のコピーとSHA-256: `X自動化/data/archive/`（`README.md` / `CHECKSUMS.txt`）

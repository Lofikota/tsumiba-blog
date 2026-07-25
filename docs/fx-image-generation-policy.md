# FX Image Generation Policy

このブログの記事画像生成は、原則としてFX特化で運用する。

## 生成構造

画像は必ず2層で作る。

1. **imagegen層**: 記事固有の主題・構図・感情を持つ「文字なしベース画像」を生成し、`public/images/articles/base/{slug}.png`へ保存する。
2. **コード合成層**: `scripts/compose-article-image.mjs`が記事frontmatterのタイトル・カテゴリ・`tsumiba 編集部`を正確に合成し、`public/images/articles/{slug}.png`を作る。

画像AIへ日本語タイトルを書かせない。文字化け・誤字・改題時の再課金を防ぐため、タイトルは必ずコードで合成する。記事タイトルだけ変わった場合は `--compose-only` でベース画像を再利用する。

`--dry-run` は外部APIを呼ばず、記事も画像も変更しない。`--compose-only` はベース画像から最終PNGだけを再生成し、記事frontmatterは変更しない。

## 方針

- 既定の一括生成対象はFX記事のみ。
- 対象は `FX口座比較`、`DMM FX`、`JFX`、`FXTF`、`松井証券FX`、`FX初心者ガイド`、`FXリスク管理`。
- NISA、副業、節税、家計、節約、保険相談、クレジットカードを主題にした画像は、通常運用では生成しない。
- 画像内テキスト、証券会社ロゴ、ブランドロゴ、利益保証を連想させる札束・高級品・煽り表現は使わない。
- 「30代会社員」「田中蓮」等の固定人物設定を使わない。記事タイプに応じ、スマホ・比較カード・書類・手順・リスク確認など最適な主題を選ぶ。
- review / comparison / guide / news で構図を変え、全記事を「男性がPCを見る写真」にしない。
- 主題は右側へ寄せ、左58%はタイトル合成用の落ち着いた余白を確保する。

## 基本プロンプト

```text
Use case: photorealistic-natural
Asset type: text-free base artwork for a 16:9 Japanese editorial blog hero and OGP image
Business direction: Domestic-FX beginner education. Help the reader compare required funds, smartphone usability, costs, and loss risk without implying profit.
Article title for context: {title}
Article category: {category}
Article description: {description}
Scene/backdrop: choose a topic-specific editorial scene based on review/comparison/guide/news. Use smartphones, neutral comparison cards, documents, step cards, or hands only when they explain the article.
Subject: no fixed persona. A generic learner is optional; no identifiable celebrity; no brand or broker logos.
Composition: landscape cover with the main visual on the right half. Keep the left 58% calm and dark enough for a later title overlay.
Style: high-end Japanese editorial illustration or natural editorial photography, trustworthy, practical, calm, distinctive, premium but not luxury.
Avoid: all in-image text, letters, numbers, readable UI, fake UI, logos, watermarks, arrows, candlestick charts, money piles, gambling feeling, get-rich-quick mood, profit guarantees, personal success imagery.
Output: landscape base artwork only. The title is added later by code.
```

## 実行例

```bash
op run --env-file .env.1password -- node scripts/generate-article-images.mjs --all
```

上記はFX記事のみを対象にする。過去記事も含めて明示的に全カテゴリへ使う場合だけ、次を使う。

既定モデルは公式推奨の `gpt-image-2`。必要な場合だけ `OPENAI_IMAGE_MODEL` 環境変数で明示的に上書きする。

```bash
op run --env-file .env.1password -- node scripts/generate-article-images.mjs --all --all-categories
```

タイトルだけを再合成する場合:

```bash
node scripts/generate-article-images.mjs --slug fx-kouza-hikaku --compose-only
```

Codex built-in imagegenを使う場合:

1. `node scripts/generate-article-images.mjs --slug <slug> --dry-run` でプロンプトを取得する。
2. Codexがbuilt-in imagegenで**文字なし**画像を生成する。
3. 出力を `public/images/articles/base/<slug>.png` へ保存する。
4. `node scripts/generate-article-images.mjs --slug <slug> --compose-only` でタイトル入り最終PNGを作る。
5. 最終PNGと記事表示を目視し、タイトル誤字・主題不一致・金融煽りがないことを確認する。

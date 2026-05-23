# FX Image Generation Policy

このブログの記事画像生成は、原則としてFX特化で運用する。

## 方針

- 既定の一括生成対象はFX記事のみ。
- 対象は `FX口座比較`、`DMM FX`、`JFX`、`FXTF`、`松井証券FX`、`FX初心者ガイド`、`FXリスク管理`。
- NISA、副業、節税、家計、節約、保険相談、クレジットカードを主題にした画像は、通常運用では生成しない。
- 画像内テキスト、証券会社ロゴ、ブランドロゴ、利益保証を連想させる札束・高級品・煽り表現は使わない。
- 会社員が申し込み前に条件とリスクを確認している雰囲気に寄せる。

## 基本プロンプト

```text
Use case: photorealistic-natural
Asset type: 16:9 hero image for a Japanese FX account comparison affiliate blog article
Business direction: FX-focused only. Prioritize FX account comparison, DMM FX, JFX, FXTF, beginner risk management, and office-worker decision support.
Article title for context: {title}
Article category: {category}
Article description: {description}
Scene/backdrop: a focused Japanese office worker comparing FX account conditions on a laptop, currency charts, risk notes, a simple comparison checklist, and a clean desk, disciplined and cautious mood, modern Japanese work-from-home setting.
Subject: realistic Japanese 30s office worker or hands-only composition depending on what feels natural; no identifiable celebrity; no brand logos, no broker logos.
Composition: editorial blog cover, strong central visual, clean negative space near the top-left for page layout, professional WordPress-style article thumbnail.
Style: photorealistic, trustworthy, warm daylight, premium but not luxury, practical financial comparison mood, high detail, natural colors.
Avoid: in-image text, fake UI labels, brand logos, watermarks, exaggerated money piles, gambling feeling, get-rich-quick mood, profit guarantees, luxury flexing, tax-saving visuals, NISA visuals, insurance consultation scenes, household budgeting scenes, credit cards.
Output: landscape image, no text.
```

## 実行例

```bash
op run --env-file .env.1password -- node scripts/generate-article-images.mjs --all
```

上記はFX記事のみを対象にする。過去記事も含めて明示的に全カテゴリへ使う場合だけ、次を使う。

```bash
op run --env-file .env.1password -- node scripts/generate-article-images.mjs --all --all-categories
```

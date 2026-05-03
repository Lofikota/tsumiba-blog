# Security Best Practices Report

作成日: 2026-05-02

## Executive Summary

Astro + Cloudflare Pages の静的ブログとして、致命的な秘密情報露出や依存関係脆弱性は検出されませんでした。
一方で、Cloudflare Pages 側のセキュリティヘッダーがリポジトリ上で未定義だったため、ブラウザ防御の土台を追加しました。

## Fixed

### SEC-001: Security headers were not defined in the repo

- Severity: Medium
- Location: `public/_headers`
- Evidence: Cloudflare Pages 用の `_headers` が存在せず、CSP / frame blocking / MIME sniffing protection がリポジトリ上で確認できなかった。
- Impact: CDN側に別途設定がない場合、クリックジャッキング、MIME sniffing、過剰なブラウザ機能許可などへの防御が弱くなる。
- Fix: `public/_headers` を追加し、以下を設定。
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
- Note: 現状はインラインstyleが多いため、`style-src 'unsafe-inline'` は一時的に許可している。将来CSSクラス化を進めるとさらに強くできる。

### SEC-002: Inline JavaScript event handlers weakened CSP compatibility

- Severity: Low
- Location: `src/pages/index.astro`
- Evidence: 記事カードに `onmouseover` / `onmouseout` のインラインイベントがあった。
- Impact: `script-src 'self'` のようなCSPを適用しにくくなる。
- Fix: インラインイベントを削除し、`.post-card:hover` / `.post-card:focus-visible` のCSSへ移動。

### SEC-003: Affiliate outbound links should not pass ranking signals

- Severity: Low
- Location: `src/components/AffiliateCTA.astro`
- Evidence: アフィリエイトCTAの外部リンクに `sponsored` はあったが `nofollow` はなかった。
- Impact: アフィリエイトリンクとしての検索エンジン向け属性がやや弱い。
- Fix: `rel="noopener noreferrer sponsored nofollow"` に変更。

## Verified

- `npm run build`: pass
- `npm audit --audit-level=moderate`: `found 0 vulnerabilities`
- High-risk frontend sinks searched: `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `javascript:` URL

## Recommended Next Steps

1. インラインstyleを段階的にCSSクラスへ移動し、CSPの `style-src 'unsafe-inline'` を外せる状態にする。
2. Cloudflare Pages本番URLで、実レスポンスヘッダーを確認する。
3. `gh auth login` 後、GitHub Actions Secrets / Variables の名前一覧を確認する。
4. 金融YMYL記事は、公開前チェックとして「PR表記」「免責」「最新公式情報確認日」「利益保証表現なし」をCIまたはチェックリスト化する。

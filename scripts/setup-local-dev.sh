#!/usr/bin/env bash
# ローカル開発環境セットアップ。
# 初回クローン後または hooks を有効化したい時に一度実行する:
#   bash scripts/setup-local-dev.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath .githooks
echo "✅ git hooks を .githooks/ に設定しました。"
echo "   記事ファイル (src/content/blog/*.mdx) のローカルコミットはブロックされます。"
echo "   手書き記事を意図的にコミットする場合: ALLOW_ARTICLE_COMMIT=1 git commit ..."

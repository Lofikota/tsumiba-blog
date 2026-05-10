#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git add -- \
  'src/layouts/BlogPost.astro' \
  'src/pages/go/[slug].astro' \
  '.env.example' \
  '.env.1password.example'

if git diff --cached --quiet; then
  echo "No staged changes for Google tag hooks."
  exit 0
fi

git commit -m "feat: add google tag conversion hooks"
git push origin main

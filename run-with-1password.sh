#!/bin/bash
# Run ren-blog commands with secrets loaded from 1Password.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.1password"
COMMAND="${1:-dev}"

if ! command -v op >/dev/null 2>&1; then
  echo "op command not found. Install 1Password CLI first."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE not found."
  echo "Copy $SCRIPT_DIR/.env.1password.example to $ENV_FILE and adjust op:// references."
  exit 1
fi

cd "$SCRIPT_DIR"

case "$COMMAND" in
  dev)
    op run --env-file "$ENV_FILE" -- npm run dev
    ;;
  build)
    op run --env-file "$ENV_FILE" -- npm run build
    ;;
  post-x)
    op run --env-file "$ENV_FILE" -- node scripts/post-to-x.js
    ;;
  *)
    echo "Usage: $0 [dev|build|post-x]"
    exit 1
    ;;
esac

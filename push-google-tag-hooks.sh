#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

bash scripts/finalize-google-tag-hooks.sh

#!/bin/zsh
# CLOUDFLARE_API_TOKEN を GitHub Secrets に登録し、x-generate.yml を再実行する
# 使い方: トークンを標準入力から渡す（例: op read "op://Private/Cloudflare API Token/credential" | ./update-cf-secret.sh）
set -e
CF_TOKEN=$(cat | tr -d '[:space:]')
[ -z "$CF_TOKEN" ] && { echo "トークンが空です"; exit 1; }

echo "1/4 Cloudflareでトークンを検証..."
VERIFY=$(curl -s -H "Authorization: Bearer $CF_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify)
echo "$VERIFY" | grep -q '"success":true' || { echo "❌ トークン無効: $VERIFY"; exit 1; }
echo "✅ トークン有効"

GH_TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill | grep '^password=' | cut -d= -f2)
REPO="Lofikota/ren-blog-"

[ -x /tmp/ghsec-venv/bin/python ] || { python3 -m venv /tmp/ghsec-venv && /tmp/ghsec-venv/bin/pip install --quiet pynacl; }

echo "2/4 リポジトリ公開鍵を取得..."
PK_JSON=$(curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/actions/secrets/public-key")

echo "3/4 暗号化してSecretsを更新..."
ENC=$(echo "$PK_JSON" | CF_TOKEN="$CF_TOKEN" /tmp/ghsec-venv/bin/python -c "
import json, sys, os
from base64 import b64encode, b64decode
from nacl import encoding, public
pk = json.load(sys.stdin)
sealed = public.SealedBox(public.PublicKey(pk['key'].encode(), encoding.Base64Encoder())).encrypt(os.environ['CF_TOKEN'].encode())
print(json.dumps({'encrypted_value': b64encode(sealed).decode(), 'key_id': pk['key_id']}))
")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Authorization: Bearer $GH_TOKEN" \
  -d "$ENC" "https://api.github.com/repos/$REPO/actions/secrets/CLOUDFLARE_API_TOKEN")
[ "$CODE" = "204" ] || [ "$CODE" = "201" ] || { echo "❌ Secrets更新失敗: HTTP $CODE"; exit 1; }
echo "✅ Secrets更新完了 (HTTP $CODE)"

echo "4/4 x-generate.yml を手動実行..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $GH_TOKEN" \
  -d '{"ref":"main"}' "https://api.github.com/repos/$REPO/actions/workflows/x-generate.yml/dispatches")
[ "$CODE" = "204" ] && echo "✅ ワークフロー起動（数分後に結果確認）" || echo "⚠️ 手動実行失敗: HTTP $CODE（Secretsは更新済み）"

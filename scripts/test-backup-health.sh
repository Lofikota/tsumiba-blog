#!/bin/bash
# ops-doctor のバックアップ健全性検査（checkBackupTarget）の fixture テスト
#
# MNT-X02（2026-07-25）の検証用。実ログ・実リポジトリには一切触れず、
# 環境変数 AIOPS_BACKUP_LOG / AIOPS_DIR / XAUTO_BACKUP_LOG / XAUTO_DIR で
# fixture を差し込んで「壊れた時にちゃんと🚨が鳴るか」「正常な時に鳴らないか」を両方確認する。
#
# なぜ必要か: AI運用/では2026-07-16〜21の6日間バックアップが全停止したのに誰も気づかなかった。
# その検知経路を X自動化/（X投稿エンジンとキュー正本）にも広げたのが MNT-X02。
# 検知コードは「壊れた状態で実際に鳴ること」を確認しないと、通るだけの飾りになる。
#
# 使い方: bash tsumiba-blog/scripts/test-backup-health.sh
# 終了コード: 0=全ケース合格 / 1=不合格あり

set -u
DOCTOR="$(cd "$(dirname "$0")" && pwd)/ops-doctor.mjs"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAIL=0

# fixture用の対象ディレクトリ（.git を置かないので 6-2-b のgit検査は自然にスキップされる）
mkdir -p "$TMP/xauto" "$TMP/aiops"

mk_log() {  # $1=出力先 $2=YYYY-MM-DD HH:MM:SS $3=done|abort
  {
    echo "=== $2 backup start ==="
    if [ "$3" = "done" ]; then
      echo "no local changes"
      echo "=== backup done ==="
    else
      echo "ERROR: gitleaks が秘密情報らしき文字列を検出。バックアップ中断。"
    fi
  } > "$1"
}

TODAY=$(date '+%Y-%m-%d %H:%M:%S')
OLD=$(date -v-3d '+%Y-%m-%d %H:%M:%S')   # 3日前 = BACKUP_STALE_DAYS(2) 超過

run_case() {  # $1=ケース名 $2=X自動化ログの状態(done|abort|missing|old) $3=期待🚨(yes/no)
  local name="$1" state="$2" expect="$3" out hit
  local xlog="$TMP/x-$state.log"
  case "$state" in
    done)    mk_log "$xlog" "$TODAY" done ;;
    abort)   mk_log "$xlog" "$TODAY" abort ;;
    old)     mk_log "$xlog" "$OLD"   done ;;
    missing) xlog="$TMP/does-not-exist.log"; rm -f "$xlog" ;;
  esac
  # AI運用側は常に正常なfixtureで固定し、X自動化側の状態だけを動かす
  mk_log "$TMP/aiops.log" "$TODAY" done
  out=$(AIOPS_BACKUP_LOG="$TMP/aiops.log" AIOPS_DIR="$TMP/aiops" \
        XAUTO_BACKUP_LOG="$xlog" XAUTO_DIR="$TMP/xauto" \
        node "$DOCTOR" --no-net 2>&1)
  if echo "$out" | grep -q 'X自動化/ '; then :; fi
  # 🚨欄にX自動化の行が出ているか
  # -E 必須: BSD sed（macOS）の基本正規表現では \| が交替にならずリテラル | になる。
  # 終了パターンが効かないと🚨行からEOFまで全部拾い、ℹ️欄の行で誤判定する（MNT-X03b）。
  if echo "$out" | sed -nE '/🚨/,/⚠️|ℹ️/p' | grep -q 'X自動化/'; then hit=yes; else hit=no; fi
  if [ "$hit" = "$expect" ]; then
    echo "✅ $name"
  else
    # 波カッコ必須: 全角「（」は set -u 下で変数名に吸い込まれ「未割り当て」で落ちる
    echo "❌ ${name}（期待🚨=${expect} 実測=${hit}）"
    echo "$out" | grep -E '🚨|X自動化|AI運用' | sed 's/^/     /'
    FAIL=1
  fi
}

echo "── checkBackupTarget fixture テスト（X自動化/ 側を壊して鳴るか確認）──"
run_case "① 完了マーカーなし（ゲート中断）→ 🚨が鳴る"   abort   yes
run_case "② 最終実行が3日前（LaunchAgent停止）→ 🚨が鳴る" old     yes
run_case "③ ログ不在（一度も動いていない）→ 🚨が鳴る"     missing yes
run_case "④ 正常（当日・完走）→ 🚨は鳴らない"             done    no

if [ "$FAIL" = 0 ]; then echo "全ケース合格"; else echo "不合格あり"; fi
exit "$FAIL"

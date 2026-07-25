#!/bin/bash
# ops-doctor のルート正本ミラー drift検査（checkRootDocsBackup / §6-3）の fixture テスト
#
# MNT-11（2026-07-25）の検証用。実 CLAUDE.md・実ミラーには一切触れず、
# 環境変数 ROOTDOCS_DIR（原本側）/ AIOPS_DIR（ミラー側）で fixture を差し込んで
# 「同期が止まった時に🚨が鳴るか」「編集当日は鳴らないか」を両方確認する。
#
# なぜ必要か: Affiliate/ はGitリポジトリではなく、ルート直下の CLAUDE.md・AGENTS.md は
# 2026-07-25まで**どのリポジトリにも属さず**全損したら復元不能だった（MNT-10で経路を作成）。
# 実体コピー方式は「同期が止まっても古いコピーが残り、守られているように見える」という
# 新しい沈黙障害を持ち込む。それを検知するのが §6-3。
# 検知コードは壊れた状態で実際に鳴ることを確認しないと、通るだけの飾りになる（MNT-X02 §5）。
#
# 使い方: bash tsumiba-blog/scripts/test-rootdocs-mirror.sh
# 終了コード: 0=全ケース合格 / 1=不合格あり

set -u
DOCTOR="$(cd "$(dirname "$0")" && pwd)/ops-doctor.mjs"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAIL=0

ROOT_FX="$TMP/root"
AIOPS_FX="$TMP/aiops"
MIRROR_FX="$AIOPS_FX/正本ミラー"
OLD_TS=$(date -v-3d '+%Y%m%d%H%M')   # 3日前 = MIRROR_DRIFT_DAYS(2) 超過

# §6-2（バックアップ健全性）を常に正常固定する。このテストの対象外の🚨を混ぜないため。
mk_ok_log() {
  {
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') backup start ==="
    echo "no local changes"
    echo "=== backup done ==="
  } > "$1"
}

run_case() {  # $1=ケース名 $2=状態 $3=期待(crit|warn|none)
  local name="$1" state="$2" expect="$3" out hit
  rm -rf "$ROOT_FX" "$AIOPS_FX"
  mkdir -p "$ROOT_FX" "$MIRROR_FX"
  printf 'ROOT DOC v1' > "$ROOT_FX/CLAUDE.md"
  printf 'ROOT DOC v1' > "$ROOT_FX/AGENTS.md"
  printf 'ROOT DOC v1' > "$MIRROR_FX/CLAUDE.md.mirror"
  printf 'ROOT DOC v1' > "$MIRROR_FX/AGENTS.md.mirror"
  case "$state" in
    synced)         : ;;
    drift-today)    printf 'ROOT DOC v2' > "$ROOT_FX/CLAUDE.md" ;;
    drift-old)      printf 'ROOT DOC v2' > "$ROOT_FX/CLAUDE.md"
                    touch -t "$OLD_TS" "$ROOT_FX/CLAUDE.md" ;;
    no-mirror-file) rm -f "$MIRROR_FX/CLAUDE.md.mirror" ;;
    no-mirror-dir)  rm -rf "$MIRROR_FX" ;;
    no-src)         rm -f "$ROOT_FX/CLAUDE.md" ;;
  esac
  mk_ok_log "$TMP/aiops.log"
  # XAUTO_DIR は存在しないパスへ向ける（実 X自動化/ の状態にテスト結果を左右させない）
  out=$(ROOTDOCS_DIR="$ROOT_FX" ROOTDOCS_MIRROR_DIR="$MIRROR_FX" \
        AIOPS_DIR="$AIOPS_FX" AIOPS_BACKUP_LOG="$TMP/aiops.log" \
        XAUTO_DIR="$TMP/no-xauto" XAUTO_BACKUP_LOG="$TMP/no-xauto.log" \
        node "$DOCTOR" --no-net 2>&1)
  # -E 必須: BSD sed（macOS）の基本正規表現では \| が交替にならずリテラル | になる。
  # 終了パターンが効かないと🚨行からEOFまで全部拾い、ℹ️欄の行で誤判定する。
  if   echo "$out" | sed -nE '/🚨/,/⚠️|ℹ️/p' | grep -qE 'ルート正本|CLAUDE\.md|AGENTS\.md'; then hit=crit
  elif echo "$out" | sed -nE '/⚠️/,/ℹ️/p'    | grep -q  'ルート正本';                       then hit=warn
  else hit=none; fi
  if [ "$hit" = "$expect" ]; then
    echo "✅ $name"
  else
    # 波カッコ必須: 全角「（」は set -u 下で変数名に吸い込まれ「未割り当て」で落ちる（MNT-X02 §5）
    echo "❌ ${name}（期待=${expect} 実測=${hit}）"
    echo "$out" | grep -E '🚨|⚠️|ルート正本|CLAUDE\.md' | sed 's/^/     /'
    FAIL=1
  fi
}

echo "── checkRootDocsBackup fixture テスト（ルート正本ミラーの drift 検知）──"
run_case "① 中身がズレて3日経過（同期が壊れている）→ 🚨が鳴る"       drift-old      crit
run_case "② 中身がズレたが編集当日（今夜23:30で同期）→ 🚨は鳴らない" drift-today    none
run_case "③ ミラーファイルが無い（経路に乗っていない）→ 🚨が鳴る"     no-mirror-file crit
run_case "④ 正本ミラー/ ごと無い→ 🚨が鳴る"                          no-mirror-dir  crit
run_case "⑤ 原本が消えた（復元手順を出す）→ ⚠️ であって🚨ではない"    no-src         warn
run_case "⑥ 同期済み → 🚨も⚠️も鳴らない"                             synced         none

# ★変異テスト: 検知コードを壊すと①が実際に落ちることを確認する。
# ヒステリシスの閾値を無効化（2→999）すると「3日ズレたまま」を見逃すはず。
# ℹ️表示や通過だけでは、不等号の向き違い・閾値の書き間違いを検出できない。
echo "── ★変異テスト（MIRROR_DRIFT_DAYS を無効化して①が落ちるか）──"
cp -p "$DOCTOR" "$TMP/doctor.orig"
sed -i '' 's/^const MIRROR_DRIFT_DAYS = 2;/const MIRROR_DRIFT_DAYS = 999;/' "$DOCTOR"
MUTANT_FAIL=0
SAVED_FAIL=$FAIL
FAIL=0
run_case "①(変異下) 3日ズレ → 🚨が鳴る" drift-old crit
if [ "$FAIL" = 1 ]; then
  echo "✅ 変異検出: 閾値を壊すと①が落ちる＝この検査は本当に効いている"
else
  echo "❌ 変異が検出できなかった。①は閾値と無関係に通っている疑い"
  MUTANT_FAIL=1
fi
cp -p "$TMP/doctor.orig" "$DOCTOR"
cmp "$TMP/doctor.orig" "$DOCTOR"; echo "   復元 CMP_EXIT=$?（0=バイト一致）"
FAIL=$(( SAVED_FAIL + MUTANT_FAIL ))

if [ "$FAIL" = 0 ]; then echo "全ケース合格"; else echo "不合格あり"; fi
exit "$FAIL"

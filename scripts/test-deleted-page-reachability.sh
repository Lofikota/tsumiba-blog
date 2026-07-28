#!/bin/bash
# ops-doctor の削除ページ到達性検査（checkDeletedPageReachability / §10）の fixture テスト
#
# MNT-CACHE-01（2026-07-26）の検証用。実リポジトリの履歴にも本番 tsumiba.com にも触れず、
# 使い捨てgitリポジトリ（DELETED_URL_REPO）＋ローカルHTTPサーバ（DELETED_URL_ORIGIN）を
# 差し込んで「消したページが本番に残っていたら🚨が鳴るか」「消えていれば鳴らないか」を両方確認する。
#
# なぜ必要か: 2026-07-26 ASP-V02-b で src/pages/tsumiba-sample.astro を git rm → build → push →
# デプロイ成功まで完了したのに、本番 /tsumiba-sample/ は HTTP 200 のままだった
# （オリジンからは消えていたが、エッジに s-maxage=604800＝7日のコピーが焼き付いていた）。
# 「消したつもり」と「実際の到達性」が最大7日ズレる典型的な沈黙障害で、
# 今回残ったのは架空の口座条件に「PR」ボタンが付いたページ＝景表法・ステマ規制リスクだった。
# 検知コードは壊れた状態で実際に鳴ることを確認しないと、通るだけの飾りになる（MNT-X02 §5）。
#
# 使い方: bash tsumiba-blog/scripts/test-deleted-page-reachability.sh
# 終了コード: 0=全ケース合格 / 1=不合格あり

set -u
DOCTOR="$(cd "$(dirname "$0")" && pwd)/ops-doctor.mjs"
TMP=$(mktemp -d)
FAIL=0

REPO="$TMP/repo"
MODE_FILE="$TMP/mode"
PORT_FILE="$TMP/port"
OLD_DATE=$(date -v-30d '+%Y-%m-%dT%H:%M:%S')   # 30日前 = DELETED_URL_WINDOW_DAYS(14) の外

# ── 本番の代わりに応答を返すローカルサーバ（1台を使い回し、応答はMODE_FILEで切り替える）──
# 実際に観測された3種類の応答を再現する:
#   cached   = エッジ残存（200 / s-maxage=604800 / age あり）… ASP-V02-b で実測した状態
#   origin   = オリジンがまだ配信（200 / age なし）… デプロイ未完了・ビルド残存の場合
#   notfound = 消えている（404 / no-store）… パージ後の正常状態
cat > "$TMP/server.mjs" <<'EOF'
import http from 'node:http';
import fs from 'node:fs';
const srv = http.createServer((req, res) => {
  const mode = fs.readFileSync(process.env.MODE_FILE, 'utf-8').trim();
  if (mode === 'notfound') { res.writeHead(404, { 'cache-control': 'no-store' }); return res.end(); }
  const h = { 'content-type': 'text/html' };
  if (mode === 'cached') { h['cache-control'] = 'public, s-maxage=604800'; h['age'] = '672'; }
  else h['cache-control'] = 'public, max-age=0, must-revalidate';
  res.writeHead(200, h);
  res.end();
});
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(process.env.PORT_FILE, String(srv.address().port)));
EOF

echo "notfound" > "$MODE_FILE"
MODE_FILE="$MODE_FILE" PORT_FILE="$PORT_FILE" node "$TMP/server.mjs" &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 1 100); do [ -s "$PORT_FILE" ] && break; sleep 0.05; done
if [ ! -s "$PORT_FILE" ]; then echo "❌ fixtureサーバが起動しなかった"; exit 1; fi
ORIGIN="http://127.0.0.1:$(cat "$PORT_FILE")"

# ── 使い捨てgitリポジトリ（削除履歴だけが意味を持つ。中身は問わない）──
build_repo() {  # $1=状態
  local state="$1"
  rm -rf "$REPO"
  mkdir -p "$REPO/src/pages/dyn" "$REPO/src/content/blog"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email test@example.com
  git -C "$REPO" config user.name test
  printf 'x' > "$REPO/src/pages/ghost.astro"
  printf 'x' > "$REPO/src/pages/keep.astro"
  printf 'x' > "$REPO/src/pages/dyn/[slug].astro"
  printf 'x' > "$REPO/src/content/blog/post.mdx"
  git -C "$REPO" add src
  git -C "$REPO" commit -qm init
  case "$state" in
    deleted)    git -C "$REPO" rm -q src/pages/ghost.astro
                git -C "$REPO" commit -qm "rm ghost" ;;
    deleted-old) git -C "$REPO" rm -q src/pages/ghost.astro
                GIT_AUTHOR_DATE="$OLD_DATE" GIT_COMMITTER_DATE="$OLD_DATE" \
                  git -C "$REPO" commit -qm "rm ghost (30日前)" ;;
    readded)    git -C "$REPO" rm -q src/pages/ghost.astro
                git -C "$REPO" commit -qm "rm ghost"
                printf 'x' > "$REPO/src/pages/ghost.astro" ;;   # 作業ツリーに復活＝消したつもりではない
    dynamic)    git -C "$REPO" rm -q "src/pages/dyn/[slug].astro"
                git -C "$REPO" commit -qm "rm dynamic route" ;;
    blog-post)  git -C "$REPO" rm -q src/content/blog/post.mdx
                git -C "$REPO" commit -qm "rm post" ;;
    none)       : ;;
  esac
}

run_case() {  # $1=ケース名 $2=リポジトリ状態 $3=本番応答 $4=期待(crit-cache|crit-origin|none)
  local name="$1" state="$2" mode="$3" expect="$4" out hit crit
  build_repo "$state"
  echo "$mode" > "$MODE_FILE"
  out=$(DELETED_URL_ORIGIN="$ORIGIN" DELETED_URL_REPO="$REPO" node "$DOCTOR" --no-net 2>&1)
  # -E 必須: BSD sed（macOS）の基本正規表現では \| が交替にならずリテラル | になる。
  # 終了パターンが効かないと🚨行からEOFまで全部拾い、ℹ️欄の行で誤判定する。
  crit=$(echo "$out" | sed -nE '/🚨/,/⚠️|ℹ️/p')
  if   echo "$crit" | grep -q 'エッジキャッシュに旧コピーが残存'; then hit=crit-cache
  elif echo "$crit" | grep -q 'オリジンがまだ配信している';       then hit=crit-origin
  else hit=none; fi
  if [ "$hit" = "$expect" ]; then
    echo "✅ $name"
  else
    # 波カッコ必須: 全角「（」は set -u 下で変数名に吸い込まれ「未割り当て」で落ちる（MNT-X02 §5）
    echo "❌ ${name}（期待=${expect} 実測=${hit}）"
    echo "$out" | grep -E '🚨|削除したページ|削除ページの到達性' | sed 's/^/     /'
    FAIL=1
  fi
}

echo "── checkDeletedPageReachability fixture テスト（削除ページの本番残存検知）──"
run_case "① 削除したのにエッジに200が残る→🚨（パージへ誘導）"        deleted     cached   crit-cache
run_case "② 削除したのにオリジンが200→🚨（デプロイ/ビルド残存へ誘導）" deleted     origin   crit-origin
run_case "③ 削除して本番も404→鳴らない"                              deleted     notfound none
run_case "④ 削除後に作業ツリーへ復活＝現役ページ→鳴らない"            readded     cached   none
run_case "⑤ 動的ルートの削除は1URLに定まらない→鳴らない"              dynamic     cached   none
run_case "⑥ 30日前の削除は窓(14日)の外→鳴らない"                     deleted-old cached   none
run_case "⑦ 記事mdxの削除も /blog/<slug>/ として検知する→🚨"          blog-post   cached   crit-cache
run_case "⑧ 削除が1件も無い→鳴らない"                                none        cached   none

# ★変異テスト: 検知コードを壊すと①が実際に落ちることを確認する。
# 「200なら残存」という判定の中核を 204 にすげ替えると、200が返っても「消えている」と読むはず。
# ℹ️表示や通過だけでは、比較演算子の向き違い・ステータスの書き間違いを検出できない。
echo "── ★変異テスト（200判定を204にすげ替えて①が落ちるか）──"
cp -p "$DOCTOR" "$TMP/doctor.orig"
sed -i '' 's/if (res.status !== 200) return { u, gone: true };/if (res.status !== 204) return { u, gone: true };/' "$DOCTOR"
MUTANT_FAIL=0
SAVED_FAIL=$FAIL
FAIL=0
run_case "①(変異下) エッジ残存200→🚨" deleted cached crit-cache
if [ "$FAIL" = 1 ]; then
  echo "✅ 変異検出: 200判定を壊すと①が落ちる＝この検査は本当に効いている"
else
  echo "❌ 変異が検出できなかった。①はステータス判定と無関係に通っている疑い"
  MUTANT_FAIL=1
fi
cp -p "$TMP/doctor.orig" "$DOCTOR"
cmp "$TMP/doctor.orig" "$DOCTOR"; echo "   復元 CMP_EXIT=$?（0=バイト一致）"
FAIL=$(( SAVED_FAIL + MUTANT_FAIL ))

if [ "$FAIL" = 0 ]; then echo "全ケース合格"; else echo "不合格あり"; fi
exit "$FAIL"

"""
Claude API × 学習データ による翌週ツイート自動生成

処理内容:
1. learning_log.jsonl から高パフォーマンスツイートと編集パターンを取得
2. 媒体型（編集部トーン） + 学習データ を組み合わせて Claude API でツイートを生成
3. 生成したツイートを tweet_queue.csv に投入（original_text も保存）

工藤さんが過去に編集したツイートを「好みのシグナル」として参照するため、
編集すればするほど生成精度が上がる設計になっている。
"""
import os
import csv
import json
import tempfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path

import anthropic
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
QUEUE_FILE = DATA_DIR / "tweet_queue.csv"
LEARNING_LOG = DATA_DIR / "learning_log.jsonl"
FIELDNAMES = [
    "id", "scheduled_date", "scheduled_time", "tweet_type",
    "text", "original_text", "status", "posted_at", "tweet_id", "error",
]

POSTING_SCHEDULE = [
    ("07:30", "型C"),  # 朝：入口づくり
    ("12:00", "型B"),  # 昼：共感・迷い潰し
    ("19:00", "型A"),  # 夕方：比較・保存
    ("21:00", "型D"),  # 夜：ストーリー・回収
]

# ASP承認済みプログラム（収益優先順）
ASP_PROGRAMS = {
    "DMM_FX": {
        "単価": "40,000円/件",
        "ブログURL": "ren-money.com/blog/dmm-fx-review/",
        "特徴": "初心者No.1・スプレッド0.2銭・24時間サポート・口座数400万超・最短1日開設",
        "向いている人": "FX初心者・スマホ派・デイトレ",
        "投稿比率": "週3本（最優先）",
    },
    "JFX": {
        "単価": "15,000円/件",
        "ブログURL": "ren-money.com/blog/jfx-review/",
        "特徴": "2025年オリコン顧客満足度FX総合No.1・MT4対応・約定力業界最高水準",
        "向いている人": "MT4ユーザー・約定力重視・自動売買",
        "投稿比率": "週2本",
    },
    "FXTF": {
        "単価": "15,000円/件",
        "ブログURL": "ren-money.com/blog/fxtf-review/",
        "特徴": "FX+CFD+ノックアウトオプションを一口座・高約定力・MT4対応",
        "向いている人": "CFD・KOに興味ある人・MT4ユーザー",
        "投稿比率": "週2本",
    },
    "エポスカード": {
        "単価": "2,600円/件",
        "ブログURL": "ren-money.com/blog/epos-card-review/",
        "特徴": "年会費永久無料・海外旅行保険500万円・エポスゴールドへの招待あり",
        "向いている人": "海外旅行好き・サブカード探し・ゴールド育成",
        "投稿比率": "週2本",
    },
}

WEEKLY_THEMES = {
    0: "FX入門（何から始めるか・少額開始・失敗回避）",
    1: "税金（副業・確定申告・控除）",
    2: "クレカ（年会費無料・保険・ポイント最適化）",
    3: "NISA補助（積立・証券口座・長期の土台）",
    4: "FX比較（DMM FX / JFX / FXTF / 松井証券FX の選び方）",
    5: "迷い潰し（申し込み前に確認したい3点）",
    6: "週次まとめ（今週の学び・LINE診断・次の一歩）",
}

TYPE_DESCRIPTIONS = {
    "型A": "比較・保存狙い。箇条書き・数字・判断軸。「迷ったらこれを見る」系。",
    "型B": "共感あるある。読者の悩みを代弁。「わかる」「最初ここで止まる」。",
    "型C": "入口づくり。診断・LINE・記事への導線を短く置く。",
    "型D": "ストーリー・体験談。失敗→学び→今の判断基準。信頼を作る。",
    "型E": "質問。選択肢を並べて、返信・反応を取りやすくする。",
    "型HENSHIN": "変身ストーリー。「読者のよくあるビフォー→転換点→アフター」を読者主語・一般化で描く時系列。編集部個人の実績語りは禁止（虚偽実績になる）。読者に「自分もできるかも」と思わせる。",
}

PERSONA = """
tsumiba編集部（FX比較メディア「tsumiba」の編集部アカウント）
- 人格：信頼できる先輩編集部。誠実・等身大・押し付けない。読者の得を最優先
- 一人称は「編集部」か、一人称を出さない。個人の人生ストーリー・個人の運用実績は語らない（架空個人ペルソナは2026-05-31に全廃）
- 禁止：「確実に儲かる」「絶対」「必ず増える」「元本保証」・虚偽の実績数字・絵文字
- 投稿の主目的は、FXをXで育てて比較・失敗回避・少額開始へ自然につなぐこと
- 280文字以内厳守（日本語1文字=1カウント）

【最重要：AIバレしない文体ルール（Grokリサーチ2026年最新）】

■ 絶対禁止（AIっぽさの元凶）
- → ━━━ ・ ① ② ③ などの記号・箇条書きを多用しない
- 完璧に整列された構造（均等な改行・完全な対称）
- 毎回同じ「問題提起→比較→リンク」の型
- 「初心者・スマホ派・サポート重視」のような体言止め羅列

■ 代わりに使う（人間らしさの出し方）
- 話し言葉全開：「めっちゃ」「マジで」「正直」「意外と」「便利すぎ」「最初はみんな」
- 感情ツッコミ：「これ気づかない人多い」「痛い目見たわ」「誰も教えてくれないよね」
- 改行は不規則に（1行空けたり詰めたり。等間隔は禁止）
- 言い切らない：「〜だと思う」「〜かもしれない」「〜かなって」

■ 投稿の長さ・構造バリエーション（必須）
- 1〜3行で終わる短投稿：28本中8本以上
- CTAなし（URLもLINEも誘導なし）の純粋な一言：28本中6本
- コメント誘導で終わる投稿：28本中6本以上（「コメントで教えて」「どれ使ってる？」）
- 長文比較投稿：28本中4本まで
- 型HENSHIN（変身ストーリー）：28本中2本以上（読者のよくある変化を読者主語で時系列に描く）

■ 実在感の出し方
- 具体数字を必ず入れる。ただし検証可能な事実の数字のみ：「スプレッド0.2銭」「キャッシュバック33,000円」「1000通貨＝約5,000円」「月5万の積み立て」
- 時間軸を入れる：「昨日の相場で」「先週キャンペーンが更新されて」「最近読者からよく聞かれるんだけど」

■ 7つのフック型（コピーライティングリポジトリ学習済み）
1. 好奇心フック：「[常識] は実は間違いだった」「FX口座、何となく選んでない？」
2. ストーリーフック：「先週、[意外なこと] が起きた」「3年前の自分に言いたいことがある」
3. 価値フック：「[結果] の方法（[よくある痛み] なし）」「[数字] つのこと」
4. 逆説フック：「みんなが言う [常識] は間違ってる」「[よくやること] をやめたら良くなった」
5. 共感フック：「わかる。最初はみんな [同じ状況] だから」
6. 数字フック：「FX口座 [数字] つ使ってわかったこと」
7. 返信誘導フック★最優先：「[A] と [B]、どっち派？」「コメントで教えて」

■ コピーライティング4原則（marketingskillsリポジトリより）
- 明瞭さ > 巧みさ：「資産形成を最適化」→「毎月5万を10年続けるだけ」
- 便益 > 特徴：「最短1日開設」→「明日から取引できる」
- 具体性 > 曖昧さ：必ず数字を入れる（「200万」「月5万」「2年で」）
- 読者の言葉：「ポートフォリオ分散」→「貯金だけじゃ不安だよね」
- buzzword禁止：「最適化」「効率的に」「実現する」「最大化する」を使わない

■ 強いCTAの設計（コメント欄誘導のみ）
- 弱い：「詳しくはこちら」「見てみて」
- 強い：「比較表、コメントに貼っておくね」「どれが向いてるかコメントで教えて」
フォーマット：[動作動詞] + [何が得られるか] + [摩擦を取り除く一言]

■ 変身ストーリー（型HENSHIN）の書き方
- 読者主語で一般化して描く（「〜で止まってた人が」「最初の一歩を踏み出す人のパターン」）。編集部個人の実績・人生は語らない
- 「転換点」を1つ特定する（「FX口座を変えてから」「1000通貨なら約5,000円と知ってから」）
- 読者に「自分もできるかも」と思わせる終わり方
- 過去を否定しすぎない（「過去の自分を責めなくていい。知らなかっただけだから」）

■ Xアルゴリズム対応ルール（2026-05-15版・重要）
エンゲージメントの重み順：返信(reply) > リポスト > いいね > DM転送 > フォロー獲得
→ 「返信を誘う」投稿が最もアルゴリズム評価が高い。コメント誘導を最優先にする。
→ 7日28本を以下の7カテゴリに分散させる（Grox自動スパム検出対策）：
   1. 問いかけ（返信誘導・最優先）
   2. まとめ情報（リポスト狙い）
   3. 体験談（信頼構築・dwell time）
   4. 逆説・反直感（議論を呼ぶ・返信増）
   5. 図解説明（テキスト比較・情報価値）
   6. 数字・データ活用（保存狙い）
   7. CTA・導線（LINE・ブログ）
→ 同じ構造を3本連続させない（フォーマット多様性）。
→ 週に2本はdwell time狙いの「読み応えある長文」を作る（最後まで読まれることが正のシグナル）。
→ ネガティブシグナル（ミュート・ブロック・報告）を受けやすいパターンを避ける：
   過度な煽り・明らかな誇大表現・同じ内容の繰り返し

■ 最強の組み合わせ
問題解決 → 体験談 → 自然リスト → 質問CTA → リンク

■ ハッシュタグルール
ハッシュタグは1投稿につき最大3個。多用禁止。
使うもの：#FX #FX口座 #FX初心者 #FXおすすめ のどれかだけ
ハッシュタグなし投稿も半数以上OK（むしろ自然）

■ 参考：AIバレしないリライト例（この文体を目指す）
---
FX口座って、何となくで決めてない？

「有名だから」「CMで見たから」だけで選んじゃう人、めっちゃ多いけど…
開設してから「これヤバい」って気づく人、9割くらいだと思う。

スプレッドの計算を間違えてたり、手数料トータルで全然考えてなかったり。
正直、誰も教えてくれないよね。

編集部で4社をまとめて比較してみて、やっと「これが基準だ」ってわかった。

DMM FXは初心者でスマホ派、サポートもしっかり欲しい人にはまずこれ。口座数No.1なだけある。
JFXはMT4でガチでやりたい人向け。満足度もかなり高い。
FXTFは意外と見落としがちなんだけど、スプレッド＋手数料をセットで計算すると実は一番コスパいいケースが多い。
松井証券FXはiDeCoも一緒に管理したい人に最高。

結局「どれが安いか」はトレードスタイルで全然変わる。
比較表はコメント欄に貼っておくね。

自分はどんなスタイルで取引してる？コメントで教えてくれたら本気で答えるよ。
---

■ 変身ストーリー例（型HENSHIN・読者主語で一般化する）
---
「FXって怖い」で止まってた人が、最初の一歩を踏み出すときのパターンはだいたい同じ。

きっかけは大きな決意じゃなくて、「1000通貨なら約5,000円から始められる」って知った瞬間だったりする。

最初の3ヶ月で大事なのは勝つことじゃなくて、退場しないこと。
少額で仕組みを体で覚えた人から、相場に残っていく。

過去に貯金できなかった自分を責めなくていい。知らなかっただけだから。
---
"""


def load_learning_data() -> dict:
    """学習ログから良い投稿・編集パターンを抽出"""
    if not LEARNING_LOG.exists():
        return {"top_tweets": [], "edit_examples": []}

    records = []
    with open(LEARNING_LOG, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    if not records:
        return {"top_tweets": [], "edit_examples": []}

    # エンゲージメントスコア上位10本
    top = sorted(records, key=lambda x: x.get("engagement_score", 0), reverse=True)[:10]
    top_tweets = [
        {
            "text": r["final_text"],
            "type": r.get("tweet_type", ""),
            "score": r.get("engagement_score", 0),
            "likes": r.get("like_count", 0),
            "impressions": r.get("impression_count", 0),
        }
        for r in top
    ]

    # 工藤さんが実際に編集したペア（学習シグナル）
    edited = [r for r in records if r.get("was_edited") and r.get("original_text")][:5]
    edit_examples = [
        {
            "before": r["original_text"][:200],
            "after": r["final_text"][:200],
            "score": r.get("engagement_score", 0),
        }
        for r in edited
    ]

    return {"top_tweets": top_tweets, "edit_examples": edit_examples}


def build_prompt(week_offset: int, learning: dict) -> str:
    """Claude への生成プロンプトを構築"""
    theme_idx = week_offset % len(WEEKLY_THEMES)
    theme = WEEKLY_THEMES[theme_idx]

    top_section = ""
    if learning["top_tweets"]:
        top_section = "\n## 過去の高パフォーマンスツイート（参考にすること）\n"
        for t in learning["top_tweets"][:5]:
            top_section += f"\n[{t['type']} / score:{t['score']:.3f}% / imp:{t['impressions']}]\n```\n{t['text']}\n```\n"

    edit_section = ""
    if learning["edit_examples"]:
        edit_section = "\n## 工藤さんの編集パターン（このスタイルに寄せること）\n"
        for e in learning["edit_examples"]:
            edit_section += f"\n【修正前（AI生成）】\n```\n{e['before']}\n```\n【修正後（ユーザー好み）】\n```\n{e['after']}\n```\n"

    type_section = "\n## 投稿タイプの定義\n"
    for t, desc in TYPE_DESCRIPTIONS.items():
        type_section += f"- {t}：{desc}\n"

    asp_section = "\n## ASP承認済みプログラム（必ずこれを収益源にする）\n"
    for name, info in ASP_PROGRAMS.items():
        asp_section += (
            f"\n### {name}（{info['単価']}）\n"
            f"- URL: {info['ブログURL']}\n"
            f"- 特徴: {info['特徴']}\n"
            f"- 向いている人: {info['向いている人']}\n"
            f"- 投稿比率: {info['投稿比率']}\n"
        )
    asp_section += "\n**ルール**: DMM FX最優先。FX全体は比較と失敗回避を中心にする。ブログURL・アフィリエイトリンクは投稿本文に含めない（コメント欄に載せるため）。\n"

    schedule_section = "\n## 今週の投稿スケジュール（7日分・計28本）\n"
    schedule_section += "各日に以下の順番で4本生成する:\n"
    for time, tweet_type in POSTING_SCHEDULE:
        schedule_section += f"- {time}: {tweet_type}\n"
    schedule_section += "さらに各週2本以上は型HENSHINを必ず入れること。\n"

    output_format = """
## 出力形式（厳守）

以下の JSON 配列だけを出力する。説明文・マークダウン・コードブロックは不要。

[
  {
    "day": 1,
    "time": "07:30",
    "type": "型C",
    "text": "ツイート本文"
  },
  ...
]

- day: 1〜7（1=今週の1日目）
- time: "07:30" / "12:00" / "19:00" / "21:00"
- type: "型A" / "型B" / "型C" / "型D" / "型E" / "型HENSHIN" または "DMM_FX" / "JFX" / "FXTF" / "エポスカード" / "バズ汎用"
- text: 280文字以内・改行は \\n で表現
- **ブログURL・アフィリエイトリンクは text に絶対に含めない**（コメント欄に別途掲載するため）
- リンク誘導したい場合は「詳しくはコメント欄に」「リンクはコメントに貼っておくね」などで締める
"""

    algorithm_section = """
## Xアルゴリズム優先指示（2026-05-15版）

以下の優先順位でコンテンツを設計する：
1. **返信(reply)最優先**：28本中最低8本は「返信を誘う問いかけ」で終わること
2. **7カテゴリ分散**：問いかけ/まとめ/体験談/逆説/図解/数字/CTAを満遍なく使う
3. **同フォーマット連続禁止**：同じ構造・同じ書き出しパターンを3本連続させない
4. **dwell time狙い**：週2本は200文字以上の「最後まで読ませる」長文を入れる
5. **フォロー動機**：週1本は「このアカウントをフォローしたい」と思わせる自己紹介型
"""

    return f"""あなたはtsumiba編集部として X（Twitter）に投稿するコンテンツを生成するシステムです。

## ペルソナ
{PERSONA}
{algorithm_section}
## 今週のテーマ
{theme}
{asp_section}{type_section}{top_section}{edit_section}{schedule_section}{output_format}"""


def next_id() -> int:
    with open(QUEUE_FILE, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    return max((int(r["id"]) for r in rows), default=0) + 1


def get_next_week_dates(week_offset: int = 0) -> list[str]:
    """翌週月曜から7日分の日付を返す（week_offset=1で翌々週）"""
    today = datetime.now()
    days_until_monday = (7 - today.weekday()) % 7 or 7
    monday = today + timedelta(days=days_until_monday + week_offset * 7)
    return [(monday + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]


def add_to_queue(tweets: list[dict], dates: list[str]) -> int:
    # pending/skip/posted すべてのスロットを除外対象にする（重複生成防止）
    existing_slots: set[tuple[str, str]] = set()
    with open(QUEUE_FILE, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row["status"] in ("pending", "posted", "skip"):
                existing_slots.add((row["scheduled_date"], row["scheduled_time"]))

    start_id = next_id()
    new_rows = []
    skipped = 0

    for tweet in tweets:
        day_idx = tweet.get("day", 1) - 1
        if day_idx >= len(dates):
            continue
        slot = (dates[day_idx], tweet.get("time", "09:00"))
        if slot in existing_slots:
            skipped += 1
            continue
        text = tweet.get("text", "").replace("\\n", "\n")
        new_rows.append({
            "id": start_id + len(new_rows),
            "scheduled_date": slot[0],
            "scheduled_time": slot[1],
            "tweet_type": tweet.get("type", ""),
            "text": text,
            "original_text": text,
            "status": "pending",
            "posted_at": "",
            "tweet_id": "",
            "error": "",
        })
        existing_slots.add(slot)

    if skipped:
        print(f"⚠️ 既存pendingと重複のためスキップ: {skipped}本")

    with open(QUEUE_FILE, "a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writerows(new_rows)

    # D1同期用SQLファイルを生成（x-generate.ymlがwrangler d1 executeで使う）
    if new_rows:
        def esc(s: str) -> str:
            return s.replace("'", "''")
        sql_lines = []
        for r in new_rows:
            sql_lines.append(
                f"INSERT OR IGNORE INTO tweet_queue "
                f"(id, scheduled_date, scheduled_time, tweet_type, text, original_text, status) VALUES ("
                f"{r['id']}, '{r['scheduled_date']}', '{r['scheduled_time']}', "
                f"'{esc(r['tweet_type'])}', '{esc(r['text'])}', '{esc(r['original_text'])}', 'pending');"
            )
        d1_sql_file = DATA_DIR / "d1_sync.sql"
        d1_sql_file.write_text("\n".join(sql_lines), encoding="utf-8")
        print(f"📄 D1同期SQL生成: {d1_sql_file}")

    return len(new_rows)


def main(week_offset: int = 0) -> None:
    load_dotenv(BASE_DIR / ".env")
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("❌ ANTHROPIC_API_KEY が未設定です")
        return

    print("📊 学習データを読み込み中...")
    learning = load_learning_data()
    print(f"   高パフォーマンス参照: {len(learning['top_tweets'])}本")
    print(f"   編集パターン参照: {len(learning['edit_examples'])}件")

    print("🤖 Claude API でツイートを生成中...")
    client = anthropic.Anthropic(api_key=api_key)
    prompt = build_prompt(week_offset, learning)

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()

    start = raw.find("[")
    end = raw.rfind("]") + 1
    if start == -1 or end == 0:
        print(f"❌ JSON が見つかりません:\n{raw[:300]}")
        return

    try:
        tweets = json.loads(raw[start:end])
    except json.JSONDecodeError as e:
        print(f"❌ JSON パースエラー: {e}\n{raw[start:start+200]}")
        return

    dates = get_next_week_dates(week_offset)
    count = add_to_queue(tweets, dates)
    print(f"✅ {count}本を翌週キューに追加しました（{dates[0]}〜{dates[-1]}）")


if __name__ == "__main__":
    import sys
    offset = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    main(week_offset=offset)

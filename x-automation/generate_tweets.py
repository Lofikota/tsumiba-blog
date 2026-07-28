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
import argparse
import csv
import json
import re
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

from broker_facts import build_broker_facts_block

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
QUEUE_FILE = DATA_DIR / "tweet_queue.csv"
LEARNING_LOG = DATA_DIR / "learning_log.jsonl"
FIELDNAMES = [
    "id", "scheduled_date", "scheduled_time", "tweet_type",
    "text", "original_text", "status", "posted_at", "tweet_id", "error",
]

OUT_OF_SCOPE_TERMS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"海外\s*FX", r"(?<![A-Za-z])CFD(?![A-Za-z])", r"ノックアウト(?:・?オプション)?",
        r"FX\s*スクール", r"(?<![A-Za-z])NISA(?![A-Za-z])", r"(?<![A-Za-z])iDeCo(?![A-Za-z])",
        r"証券口座", r"保険相談|保険見直し|生命保険|損害保険", r"クレジットカード",
        r"自動売買|システムトレード|シストレ|(?<![A-Za-z])EA(?![A-Za-z])",
    )
]
SCOPE_HARD_NEGATION_PATTERN = re.compile(
    r"対象外|(?:でき|使え|動かせ|選べ|始められ)(?:ません|ない|ず)|"
    r"(?:おすすめ|オススメ|お勧め|推奨|紹介|掲載)(?:しません|しない|できません|できない|せず)|"
    r"扱(?:いません|わない|わず|っていません|っていない)|含め(?:ません|ない)|"
    r"評価(?:しません|しない|していません|していない)|られ(?:ません|ない)|"
    r"不可|非対応|禁止|避け(?:る|ます|ましょう)|手を出さ(?:ない|ず)|"
    r"メリット(?:が|は)?(?:ありません|ない)|"
    r"元本保証[^、,]*ない|では(?:ありません|ない)|わけではない",
    re.IGNORECASE,
)
SCOPE_PURE_WARNING_PATTERN = re.compile(
    r"(?:デメリット|危険性|注意点?|リスク)(?:について|を|と|が|は|も|の)?.{0,24}"
    r"(?:説明|解説|整理|確認|理解)(?:します|する|してください|が必要です|が必要だ)?$|"
    r"(?:危険性|リスク)(?:が|は|も)(?:あります|ある|高い|大きい)$|"
    r"無登録業者(?:が|は)?(?:多い|多く存在します|多く存在する)$",
    re.IGNORECASE,
)
SCOPE_WARNING_CONTINUATION_PATTERN = re.compile(
    r"(?:危険性|注意点?|リスク)(?:が|は|も)?.{0,20}(?:ある|高い|大きい)ため$|"
    r"無登録業者(?:が|は)?多く$",
    re.IGNORECASE,
)
SCOPE_ADVERSATIVE_PATTERN = re.compile(
    r"ですが|ますが|ませんが|ないが|ものの|けれど(?:も)?|しかし(?:ながら)?|一方で|ただし"
)
SCOPE_CLAUSE_SPLIT_PATTERN = re.compile(rf"[、,；;]|{SCOPE_ADVERSATIVE_PATTERN.pattern}")
UNVERIFIED_EXPERIENCE_PATTERNS = [
    re.compile(pattern)
    for pattern in (
        r"(?:編集部|筆者|僕|私).{0,24}(?:使った|使って|試した|取引した|口座(?:を)?開設(?:した|して)|運用した|儲かった|損した)",
        r"(?:使って|試して|取引して|口座開設して).{0,24}(?:わかった|分かった|気づいた)",
        r"編集部(?:の|が試した)?体験談",
        r"(?:読者|フォロワー|知人|友人|ユーザー)の?\s*[A-ZＡ-Ｚa-zａ-ｚ]?\s*さん.{0,40}(?:利益|勝ち|稼い|儲か|資産が増)",
        r"(?:利用者|ユーザー|顧客|申込者|受講生|購入者).{0,40}(?:利益|成果|稼げた|儲かった).{0,32}(?:声|報告|届(?:いた|きました))",
        r"最初はみんな|読者から(?:よく|一番多く|多く)聞",
        r"(?:読者|初心者|人).{0,30}(?:口座開設|FXを始め).{0,40}(?:人生が変わ|利益|稼げ|できるようにな)",
    )
]
THIRD_PARTY_SUBJECT_PATTERN = re.compile(
    r"読者|利用者|口座利用者|ユーザー|顧客|お客様|申込者|会員|受講生|購入者|成功者|体験者|トレーダー"
)
THIRD_PARTY_RESULT_PATTERN = re.compile(r"利益|稼げ|儲|成果|収益|勝て|黒字")
THIRD_PARTY_HEARSAY_PATTERN = re.compile(r"声|好評|報告|届|寄せ|口コミ|感想|評価|投稿")
SOCIAL_PROOF_PATTERN = re.compile(r"声|口コミ|レビュー|体験談|アンケート|コメント|回答|紹介|感想|評価|投稿")
SOCIAL_RESULT_PATTERN = re.compile(r"利益|収益|稼|儲|成功|増え|プラス|黒字|勝(?:て|った|ち|率|てる)")
SOCIAL_NUMBER_PATTERN = re.compile(
    r"(?:\d[\d,.]*|[０-９][０-９，．]*|[〇零一二三四五六七八九十百千万億]+)"
    r"(?:\s*(?:円|万円|%|％|倍|件|人|か月|ヶ月|月))"
)
INTERNAL_DEAL_PATTERN = re.compile(r"案件|提携プログラム|広告プログラム|アフィリエイト")
INTERNAL_PAYOUT_EVENT_PATTERN = re.compile(
    r"受け取|支払|支給|入金|振込|(?:円|万円)(?:が)?(?:入る|入ります)|"
    r"(?:成約|獲得|申込|承認|発生)(?:する|した|ごと|たび|ベース)"
)
INTERNAL_MONEY_PATTERN = re.compile(
    r"(?:\d[\d,，]*(?:\.\d+)?|[０-９][０-９，．]*|"
    r"[〇零一二三四五六七八九十百千万億壱弐参肆伍陸漆捌玖拾佰仟萬]+)"
    r"\s*(?:円|万円)"
)
INTERNAL_ECONOMICS_CONTEXT_PATTERN = re.compile(
    r"広告|案件|提携|アフィリエイト|リンク|申込|成約|獲得|承認|契約"
)
INTERNAL_UNIT_EVENT_PATTERN = re.compile(
    r"(?:\d+|[０-９]+|[〇零一二三四五六七八九十百千万億]+)\s*(?:件|人)(?:あたり|につき|ごと)?|"
    r"(?:申込|申し込|成約|獲得|承認|契約|発生|決ま(?:る|り)).{0,12}(?:ごと|たび|ベース)"
)
ASP_REWARD_PATTERNS = [
    re.compile(pattern)
    for pattern in (
        r"報酬|単価|コミッション|紹介料|成約|(?<![A-Za-z])CV(?![A-Za-z])|"
        r"(?<![A-Za-z])CPA(?![A-Za-z])|(?<![A-Za-z])EPC(?![A-Za-z])|アフィリエイト収益",
        r"成果報酬|報酬単価|承認報酬|案件単価|高単価",
        r"(?:1件(?:成約|獲得|申込|承認).{0,24}(?:収益|報酬|利益)|(?:収益|報酬|利益).{0,24}1件(?:成約|獲得|申込|承認))",
        r"\d[\d,，]*\s*円\s*[/／]\s*件",
        r"[〇零一二三四五六七八九十百千万億壱弐参肆伍陸漆捌玖拾佰仟萬]+\s*円\s*[/／]\s*件",
        r"(?:成果報酬|報酬単価|アフィリエイト報酬|承認報酬).{0,20}"
        r"(?:\d[\d,]*(?:\.\d+)?\s*(?:万|千)?|[〇零一二三四五六七八九十百千万億壱弐参肆伍陸漆捌玖拾佰仟萬]+)\s*円",
        r"1件(?:あたり|につき).{0,12}\d[\d,，]*\s*円",
        r"(?:(?:この|当該|ASP|アフィリエイト)?案件.{0,24}高単価|高単価.{0,24}(?:案件|報酬|プログラム))",
    )
]
JFX_CONTEXT_PATTERN = re.compile(r"JFX|MATRIX\s*TRADER|マトリックス・?トレーダー", re.IGNORECASE)
# 生成物ガード（先生層の指示ではなく、出力を機械的に弾く最終防波堤）。
# 判定根拠の正本: AI運用/データ正本/brokers_*.yaml の brokers[id=jfx] の mt4_ea と notes。
# 正本の条件が変わったらこの正規表現も見直す（正本→ここは自動同期されない）。
# BROKER-F02（2026-07-26）: MT4は2026-08-19に提供終了しMT5へ移行するが、
# 「チャート分析専用・発注機能は未実装」という位置づけはMT5でも変わらない
# （公式 https://www.jfx.co.jp/mt5/ ）。バージョン名に依存せず検知する。
JFX_FALSE_CAPABILITY_PATTERNS = [
    re.compile(
        r"(?:MT4|MT5|MetaTrader\s*[45]?)(?:\s*に)?対応|(?:MT4|MT5|MetaTrader\s*[45]?).{0,80}(?:(?:(?:で|から|を使って).{0,16})?"
        r"(?:発注|注文|取引|売買|エントリー).{0,12}"
        r"(?:でき(?!ない|ません|ず)|可能|行え|出せ)|(?:EA|自動売買).{0,18}"
        r"(?:動かせ(?!ない|ません|ず)|使え(?!ない|ません|ず)|でき(?!ない|ません|ず)|可能|対応))",
        re.IGNORECASE,
    ),
    re.compile(r"(?:EA|自動売買).{0,24}(?:できる|動かせる|使える|可能|向いている|に対応)", re.IGNORECASE),
]
JFX_MT4_CONNECTOR_PATTERN = re.compile(
    r"(?:MT4|MT5|MetaTrader\s*[45]?).{0,32}?(?:から|上で|を使って|経由で|で)(.{0,48})",
    re.IGNORECASE,
)
JFX_OPERATION_PATTERN = re.compile(
    r"発注|注文|取引|売買|エントリー|新規ポジション|"
    r"(?:建玉|保有玉|保有ポジション|ポジション).{0,12}(?:保有|建て|閉じ|決済|手仕舞|クローズ|解消|変更|管理)|"
    r"(?:建て|閉じ|決済|手仕舞|クローズ|解消|変更|管理).{0,12}(?:建玉|保有玉|保有ポジション|ポジション)|"
    r"建て|決済|手仕舞い|クローズ|解消|利確|損切り"
)
JFX_OPERATION_NEGATION_PATTERN = re.compile(
    r"できない|できません|できず|られない|られません|不可|非対応|行わない|しない|使えない|分析専用|"
    r"実装されていない|実装されていません|実装されない|未実装|搭載されていない|搭載されていません"
)
MATRIX_ORDER_PATTERNS = [
    re.compile(
        r"(?:発注|注文)(?:は|を)?.{0,8}MATRIX\s*TRADER.{0,18}(?:から|で)?.{0,8}(?:行|実行)",
        re.IGNORECASE,
    ),
    re.compile(
        r"MATRIX\s*TRADER.{0,18}(?:から|で).{0,18}(?:発注|注文).{0,12}(?:行|でき)",
        re.IGNORECASE,
    ),
]


def has_affirmative_mt4_operation(sentence: str) -> bool:
    for connector_match in JFX_MT4_CONNECTOR_PATTERN.finditer(sentence):
        operation_match = JFX_OPERATION_PATTERN.search(connector_match.group(1))
        if not operation_match:
            continue
        suffix = connector_match.group(1)[operation_match.start():operation_match.start() + 36]
        if not JFX_OPERATION_NEGATION_PATTERN.search(suffix):
            return True
    return False


def unsafe_content_reason(text: str) -> str | None:
    """危険な生成物をCSV/D1用データの作成前に決定論的に拒否する。"""
    for sentence in filter(None, re.split(r"[。\n]", text)):
        if any(pattern.search(sentence) for pattern in OUT_OF_SCOPE_TERMS):
            adversative_parts = SCOPE_ADVERSATIVE_PATTERN.split(sentence)
            if (
                len(adversative_parts) > 1
                and not (
                    SCOPE_HARD_NEGATION_PATTERN.search(adversative_parts[-1])
                    or SCOPE_PURE_WARNING_PATTERN.search(adversative_parts[-1])
                )
            ):
                return "scope外テーマは明示的な否定・注意喚起以外では扱わない"

            clauses = list(filter(None, (
                part.strip()
                for part in SCOPE_CLAUSE_SPLIT_PATTERN.split(sentence)
            )))
            for index, clause in enumerate(clauses):
                has_scope_term = any(
                    pattern.search(clause)
                    for pattern in OUT_OF_SCOPE_TERMS
                )
                if has_scope_term:
                    # 後続節の安全語で、先行する肯定的なscope節を救済しない。
                    warning_leads_to_hard_negation = (
                        SCOPE_WARNING_CONTINUATION_PATTERN.search(clause)
                        and any(
                            SCOPE_HARD_NEGATION_PATTERN.search(next_clause)
                            for next_clause in clauses[index + 1:]
                        )
                    )
                    if not (
                        SCOPE_HARD_NEGATION_PATTERN.search(clause)
                        or SCOPE_PURE_WARNING_PATTERN.search(clause)
                        or warning_leads_to_hard_negation
                    ):
                        return "scope外テーマは明示的な否定・注意喚起以外では扱わない"
        jfx_match = JFX_CONTEXT_PATTERN.search(sentence)
        if jfx_match:
            # MT4の禁止操作と、正しいMATRIX TRADER発注を主体別に分離する。
            jfx_context = sentence[jfx_match.start():]
            for pattern in MATRIX_ORDER_PATTERNS:
                jfx_context = pattern.sub(" ", jfx_context)
            if (
                has_affirmative_mt4_operation(jfx_context)
                or any(pattern.search(jfx_context) for pattern in JFX_FALSE_CAPABILITY_PATTERNS)
            ):
                return "JFX不変条件違反（MT4は分析専用・発注/EA不可）"
        if (
            INTERNAL_DEAL_PATTERN.search(sentence)
            and INTERNAL_PAYOUT_EVENT_PATTERN.search(sentence)
            and INTERNAL_MONEY_PATTERN.search(sentence)
        ):
            return "ASP内部報酬額"
        if (
            INTERNAL_ECONOMICS_CONTEXT_PATTERN.search(sentence)
            and INTERNAL_UNIT_EVENT_PATTERN.search(sentence)
            and (
                INTERNAL_MONEY_PATTERN.search(sentence)
                or INTERNAL_PAYOUT_EVENT_PATTERN.search(sentence)
            )
        ):
            return "ASP内部報酬額"
        normalized_for_reward = unicodedata.normalize("NFKC", sentence)
        for pattern in ASP_REWARD_PATTERNS:
            if pattern.search(normalized_for_reward):
                return "ASP内部報酬額"
        for pattern in UNVERIFIED_EXPERIENCE_PATTERNS:
            if pattern.search(sentence):
                return f"未確認体験・読者反応: {pattern.pattern}"
        if (
            THIRD_PARTY_SUBJECT_PATTERN.search(sentence)
            and THIRD_PARTY_RESULT_PATTERN.search(sentence)
            and THIRD_PARTY_HEARSAY_PATTERN.search(sentence)
        ):
            return "未確認体験・読者反応: 第三者成果の伝聞"
        if (
            SOCIAL_PROOF_PATTERN.search(sentence)
            and (
                SOCIAL_RESULT_PATTERN.search(sentence)
                or SOCIAL_NUMBER_PATTERN.search(sentence)
            )
        ):
            return "未確認体験・読者反応: 社会的証明と成果・数値の共起"
    return None

WEEK1_PLAN = [
    {"day": 1, "time": "21:00", "type": "共感", "mako_type": "型A"},
    {"day": 2, "time": "07:30", "type": "チェックリスト", "mako_type": "型D"},
    {"day": 3, "time": "12:00", "type": "公式解説", "mako_type": "型B"},
    {"day": 4, "time": "19:00", "type": "質問応答", "mako_type": "型E"},
    {"day": 5, "time": "21:00", "type": "比較", "mako_type": "型C"},
    {"day": 6, "time": "12:00", "type": "共感", "mako_type": "型A"},
    {"day": 7, "time": "07:30", "type": "チェックリスト", "mako_type": "型D"},
]

# 比較対象の業者事実はここに書かない。正本 AI運用/データ正本/brokers_*.yaml から
# broker_facts 経由でロードする（DOCTRINE-D02-b）。内部報酬額は生成promptへ渡さない。
# ツイートは280文字なので、読者が判断に使う項目だけに絞って渡す。
TWEET_FACT_FIELDS = ["min_unit", "spread", "losscut", "app", "demo", "mt4_ea", "kyc"]

# 初週はX-P01最終版どおり1日1本×7日。Phase 0中はx-generate停止済み。
WEEKLY_THEMES = {
    0: "FX入門（何から始めるか・少額開始・失敗回避）",
    1: "FXの税金（確定申告・損益通算・経費）",
    2: "FXのコスト（スプレッド・手数料の実質比較）",
    3: "FXのリスク管理（レバレッジ・ロスカット・余剰資金）",
    4: "FX比較（DMM FX / JFX / FXTF の選び方）",
    5: "迷い潰し（申し込み前に確認したい3点）",
    6: "週次まとめ（今週の学び・比較記事への次の一歩）",
}

TYPE_DESCRIPTIONS = {
    "型A": "比較・保存狙い。箇条書き・数字・判断軸。「迷ったらこれを見る」系。",
    "型B": "共感あるある。読者の悩みを代弁。「わかる」「最初ここで止まる」。",
    "型C": "入口づくり。記事・比較ページへの導線を短く置く。",
    "型D": "調査・検証記録。公式情報→比較して分かった差→判断基準。未確認の利用体験は書かない。",
    "型E": "質問。選択肢を並べて、返信・反応を取りやすくする。",
}

PERSONA = """
tsumiba編集部（FX比較メディア「tsumiba」の編集部アカウント）
- 人格：信頼できる先輩編集部。誠実・等身大・押し付けない。読者の得を最優先
- 一人称は「編集部」か、一人称を出さない。個人・読者の人生ストーリー、利用体験、運用実績、変身談を作らない
- 禁止：「確実に儲かる」「絶対」「必ず増える」「元本保証」・虚偽の実績数字・絵文字
- 投稿の主目的は、FXをXで育てて比較・失敗回避・少額開始へ自然につなぐこと
- 280文字以内厳守（日本語1文字=1カウント）
- 業者の条件・ツール対応可否は、渡された【業者事実ブロック】の値だけを使う。ブロックに無い条件は書かない。「MT4対応」のような要約語で条件を丸めない
- 読者の声・質問数・相場観測は、確認済みデータがなければ事実として書かない
- 具体数字は公式確認済みの事実だけを使い、確認日・適用条件を省略しない

■ 文体
- → ━━━ ・ ① ② ③ などの記号・箇条書きを多用しない
- 完璧に整列された構造（均等な改行・完全な対称）
- 毎回同じ「問題提起→比較→リンク」の型
- 「初心者・スマホ派・サポート重視」のような体言止め羅列
- 話し言葉は使えるが、未確認の多数派・読者反応を根拠にしない
- 感情表現は「ここは見落としやすい」「条件を先に確認したい」のように事実へ接続する
- **空行（連続改行）は使わない**。改行は文の区切りだけに使い、詰まった密度で書く。「段落＋空行」の均等ブロック構造はAIの署名なので禁止（2026-07-05 工藤指示）
- 言い切らない：「〜だと思う」「〜かもしれない」「〜かなって」
- 同じ書き出し・同じ締めを連続させない
- 問いは本文から必然的に生まれる1問だけ。保存・RT・フォローを直接要求しない
- URL付き投稿は週1本まで。リンク近くにPRを明示する
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
                    record = json.loads(line)
                    learning_text = "\n".join(
                        filter(None, (record.get("final_text", ""), record.get("original_text", "")))
                    )
                    if not unsafe_content_reason(learning_text):
                        records.append(record)
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

    asp_section = (
        "\n"
        + build_broker_facts_block(TWEET_FACT_FIELDS)
        + "\n\n**ルール**: 案件の優先順位は内部報酬額で決めない。"
        "読者の条件と公式情報の比較を優先し、URLは本文に含めない。\n"
    )

    schedule_section = "\n## 初週の日別類型（X-P01最終版・1日1本×7日）\n"
    for item in WEEK1_PLAN:
        schedule_section += (
            f"- D{item['day']}: {item['type']} / {item['mako_type']} / 提案時刻 {item['time']}\n"
        )

    output_format = """
## 出力形式（厳守）

以下の JSON 配列だけを出力する。説明文・マークダウン・コードブロックは不要。

[
  {
    "day": 1,
    "time": "21:00",
    "type": "共感",
    "text": "ツイート本文"
  },
  ...
]

- day: 1〜7（1=今週の1日目）
- time: "07:30" / "12:00" / "19:00" / "21:00"
- type: 各日の指定どおり「共感 / チェックリスト / 公式解説 / 質問応答 / 比較」のいずれか
- text: 280文字以内・改行は \\n で表現
- **ブログURL・アフィリエイトリンクは text に絶対に含めない**（コメント欄に別途掲載するため）
- リンク誘導したい場合は「詳しくはコメント欄に」「リンクはコメントに貼っておくね」などで締める
"""

    algorithm_section = """
## Xアルゴリズム優先指示（2026-05-15版）

以下の優先順位でコンテンツを設計する：
1. **1日1本×7日**：X-P01の確定順を変えない
2. **返信は必然性優先**：質問応答型だけ、本文から自然に生じる1問で終える
3. **同フォーマット連続禁止**：同じ構造・同じ書き出しパターンを3本連続させない
4. **検証優先**：公式情報・確認日・適用条件がない数値や読者反応を作らない
5. **CTAは週1本まで**：リンク近くにPRを置き、申込を急がせない
"""

    return f"""あなたはtsumiba編集部として X（Twitter）に投稿するコンテンツを生成するシステムです。

## 現行ターゲット・scope（最優先、他の参考例より優先）
- 対象読者: 少額で国内FXを始めたい、20代・スマホ中心の初心者。職業は固定しない
- 対象: 国内FX口座の比較、口座開設、スマホアプリ、少額取引、レバレッジ・ロスカット・追証・税金・詐欺対策、入出金・デモ・サポート・取引時間
- 対象外: 海外FX、CFD、ノックアウトオプション、FXスクール、EA・自動売買の実運用推奨、証券、保険、クレジットカード
- FXの実利用体験核は現在ゼロ。編集部や架空個人が口座を使った・取引した・利益や損失を得たという体験を生成しない
- 過去投稿・編集例は文体だけの参考。旧ターゲット、scope外商品、未確認体験、金融条件は継承しない
- 業者の取引条件・ツール対応可否は【業者事実ブロック】の値だけを使う。ブロックに無い条件は書かない。「MT4対応」のような要約語で条件を丸めない

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


def get_next_week_dates(week_offset: int = 0, start: str | None = None) -> list[str]:
    """翌週月曜から7日分の日付を返す（week_offset=1で翌々週）"""
    if start:
        first = datetime.strptime(start, "%Y-%m-%d")
        return [(first + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    today = datetime.now()
    days_until_monday = (7 - today.weekday()) % 7 or 7
    monday = today + timedelta(days=days_until_monday + week_offset * 7)
    return [(monday + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]


def add_to_queue(tweets: list[dict], dates: list[str]) -> int:
    if len(tweets) != len(WEEK1_PLAN):
        print(f"⚠️ 初週生成は7本ちょうどが必要です（実際: {len(tweets)}本）。キュー書込を中止します")
        return 0
    days = [tweet.get("day") for tweet in tweets]
    if not all(isinstance(day, int) for day in days) or sorted(days) != list(range(1, len(WEEK1_PLAN) + 1)):
        print("⚠️ dayは1〜7を重複なく1件ずつ含む必要があります。キュー書込を中止します")
        return 0

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
        day = tweet.get("day")
        if not isinstance(day, int) or not 1 <= day <= len(WEEK1_PLAN):
            skipped += 1
            continue
        expected = WEEK1_PLAN[day - 1]
        slot = (dates[day - 1], expected["time"])
        if slot in existing_slots:
            skipped += 1
            continue
        text = tweet.get("text", "").replace("\\n", "\n")
        unsafe_reason = unsafe_content_reason(text)
        if unsafe_reason:
            skipped += 1
            print(f"⚠️ scope/体験ゲートでスキップ: {unsafe_reason}")
            continue
        new_rows.append({
            "id": start_id + len(new_rows),
            "scheduled_date": slot[0],
            "scheduled_time": slot[1],
            "tweet_type": expected["type"],
            "text": text,
            "original_text": text,
            "status": "pending",
            "posted_at": "",
            "tweet_id": "",
            "error": "",
        })
        existing_slots.add(slot)

    if skipped:
        print(f"⚠️ 重複または安全ゲートによりスキップ: {skipped}本")

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


def build_week1_plan(dates: list[str]) -> list[dict]:
    """X-P01最終版と同期した、書込を伴わない初週7本の器を返す。"""
    return [
        {
            "id": f"X30-D{item['day']:02d}-P01",
            "day": item["day"],
            "date": dates[item["day"] - 1],
            "time": item["time"],
            "type": item["type"],
            "mako_type": item["mako_type"],
            "text": None,
            "status": "draft",
        }
        for item in WEEK1_PLAN
    ]


def generate_and_queue(week_offset: int = 0, planned_start: str | None = None) -> None:
    import anthropic
    from dotenv import load_dotenv

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

    json_start = raw.find("[")
    json_end = raw.rfind("]") + 1
    if json_start == -1 or json_end == 0:
        print(f"❌ JSON が見つかりません:\n{raw[:300]}")
        return

    try:
        tweets = json.loads(raw[json_start:json_end])
    except json.JSONDecodeError as e:
        print(f"❌ JSON パースエラー: {e}\n{raw[json_start:json_start+200]}")
        return

    dates = get_next_week_dates(week_offset, planned_start)
    count = add_to_queue(tweets, dates)
    print(f"✅ {count}本を翌週キューに追加しました（{dates[0]}〜{dates[-1]}）")


def main() -> int:
    parser = argparse.ArgumentParser(description="初週7本の安全dry-run。API/キュー書込は--execute時のみ")
    parser.add_argument("week_offset", nargs="?", type=int, default=0)
    parser.add_argument("--start", help="D1候補日 YYYY-MM-DD")
    parser.add_argument("--execute", action="store_true", help="API生成とローカルキュー書込を明示的に許可")
    args = parser.parse_args()

    dates = get_next_week_dates(args.week_offset, args.start)
    if not args.execute:
        result = {
            "mode": "dry-run",
            "posts": build_week1_plan(dates),
            "queue_written": False,
            "api_called": False,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    generate_and_queue(args.week_offset, args.start)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

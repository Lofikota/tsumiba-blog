"""生成プロンプトへ渡す「業者事実ブロック」を組み立てる。DOCTRINE-D02-b。

事実の正本は AI運用/データ正本/brokers_*.yaml。ここが読むのはその派生物
tsumiba-blog/data/broker-facts.json（生成: node scripts/sync-broker-facts.mjs）。
プロンプト本文に業者の条件・数値を書かず、必ずこのブロック経由で渡す。
scripts/broker-facts.mjs のPython版で、読むファイル・除外規則は同一。
"""
import hashlib
import json
from datetime import date, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
FACTS_PATH = BASE_DIR.parent / "data" / "broker-facts.json"
AFFILIATE_ROOT = BASE_DIR.parents[1]

USAGE_RULE = "\n".join([
    "**このブロックの使い方（厳守）**",
    "- 業者ごとの条件・数値・ツール対応可否は、このブロックに書かれた値だけを使う",
    "- ブロックに無い条件は書かない（「たぶん対応している」等の推測で埋めない）",
    "- 「MT4対応」のような要約語で条件を丸めない。書かれた条件文をそのまま条件付きで書く",
    "- 数値を書くときは確認日と適用条件を省略しない",
])

NO_FACTS_BLOCK = "\n".join([
    "## 業者事実ブロック",
    "",
    "今回は業者事実が渡されていない。**業者固有の条件・数値・ツール対応可否は一切書かない**。",
    "一般的な仕組みの説明だけを書き、社名を出した条件の断定をしない。",
])


def _days_since(date_str: str) -> int:
    try:
        return (date.today() - datetime.strptime(date_str, "%Y-%m-%d").date()).days
    except (TypeError, ValueError):
        return 10**6


def _warn_if_stale_against_source(data: dict) -> None:
    """正本が読める環境（ローカル）でのみ、派生JSONが古くないかを突合する。"""
    rel = (data.get("source") or {}).get("path")
    if not rel:
        return
    source = AFFILIATE_ROOT / rel
    if not source.exists():  # CIでは正本リポジトリが無い＝突合しない
        return
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    if sha != data["source"].get("sha256"):
        print(f"⚠️ data/broker-facts.json が正本({rel})より古い。node scripts/sync-broker-facts.mjs を実行してください")


def build_broker_facts_block(field_keys: list[str] | None = None) -> str:
    """field_keys で渡す項目を絞る（Noneなら全項目）。"""
    if not FACTS_PATH.exists():
        print("⚠️ data/broker-facts.json が無い。業者事実なしで生成する（業者条件は書かせない）")
        return NO_FACTS_BLOCK

    data = json.loads(FACTS_PATH.read_text(encoding="utf-8"))
    _warn_if_stale_against_source(data)

    limit = data.get("stale_after_days", 90)
    stale_count = 0
    sections = []

    for broker in data.get("brokers", []):
        facts = []
        for fact in broker.get("facts", []):
            if field_keys is not None and fact["key"] not in field_keys:
                continue
            if _days_since(fact.get("checked")) > limit:
                stale_count += 1  # 正本 meta.policy の再確認期限切れ。古い条件を先生層へ流さない
                continue
            facts.append(fact)
        if not facts:
            continue
        lines = [f"### {broker['service']}", f"- 記事URL: {broker['url']}"]
        lines += [f"- {f['label']}（公式確認 {f['checked']}）: {f['value']}" for f in facts]
        if broker.get("notes"):
            lines.append(f"- 表記注意: {broker['notes']}")
        sections.append("\n".join(lines))

    if stale_count:
        print(f"⚠️ 確認日が{limit}日を超えた事実を{stale_count}件除外した。正本の再確認が必要")
    if not sections:
        return NO_FACTS_BLOCK

    return "\n".join([
        "## 業者事実ブロック（正本: AI運用/データ正本/brokers_*.yaml）",
        "",
        USAGE_RULE,
        "",
        "\n\n".join(sections),
    ])

"""
X（Twitter）自動投稿スクリプト
tweet_queue.csv から予定時刻のツイートを取得して API で投稿する
GitHub Actions から呼び出す想定（JST 7:30/12:00/19:00/21:00）
quote_tweet_url 列があれば引用ツイートとして投稿する
"""
import os
import re
import csv
import time
import tempfile
import shutil
import logging
from datetime import datetime, timedelta
from pathlib import Path

import tweepy
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
QUEUE_FILE = DATA_DIR / "tweet_queue.csv"
LOG_DIR = BASE_DIR / "logs"
LOG_FILE = LOG_DIR / "x_poster.log"
WINDOW_BEFORE_MINUTES = 20  # 実行時刻の何分前まで拾うか（Actions早期起動・clock skew対応）
WINDOW_AFTER_MINUTES = 20   # 実行時刻の何分後まで拾うか（Actions遅延対応）

LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)


def load_credentials() -> dict:
    load_dotenv(BASE_DIR / ".env")
    return {
        "api_key": os.getenv("X_API_KEY"),
        "api_secret": os.getenv("X_API_SECRET"),
        "access_token": os.getenv("X_ACCESS_TOKEN"),
        "access_token_secret": os.getenv("X_ACCESS_TOKEN_SECRET"),
    }


def get_client(creds: dict) -> tweepy.Client:
    return tweepy.Client(
        consumer_key=creds["api_key"],
        consumer_secret=creds["api_secret"],
        access_token=creds["access_token"],
        access_token_secret=creds["access_token_secret"],
    )


def find_pending_tweets() -> list[dict]:
    """実行時刻の前後ウィンドウ内に予定された未投稿ツイートを返す（重複投稿防止）"""
    now = datetime.now()
    window_start = now - timedelta(minutes=WINDOW_BEFORE_MINUTES)
    window_end = now + timedelta(minutes=WINDOW_AFTER_MINUTES)

    pending = []
    with open(QUEUE_FILE, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row["status"] != "pending":
                continue
            try:
                scheduled = datetime.strptime(
                    f"{row['scheduled_date']} {row['scheduled_time']}",
                    "%Y-%m-%d %H:%M",
                )
                if window_start <= scheduled <= window_end:
                    pending.append(row)
            except ValueError:
                logger.warning(f"日時パースエラー: id={row.get('id')}")
    pending.sort(key=lambda r: f"{r['scheduled_date']} {r['scheduled_time']}")
    return pending


def update_queue(row_id: str, *, tweet_id: str = "", error: str = "") -> None:
    """CSV のステータスをアトミックに更新する（一時ファイル → rename）"""
    rows = []
    fieldnames = []
    with open(QUEUE_FILE, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        for row in reader:
            if row["id"] == row_id:
                if error:
                    row["status"] = "error"
                    row["error"] = error
                else:
                    row["status"] = "posted"
                    row["posted_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    row["tweet_id"] = tweet_id
            rows.append(row)

    tmp = tempfile.NamedTemporaryFile(
        mode="w", delete=False, encoding="utf-8", newline="",
        dir=DATA_DIR, suffix=".tmp"
    )
    writer = csv.DictWriter(tmp, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    tmp.close()
    shutil.move(tmp.name, QUEUE_FILE)


def main() -> None:
    logger.info("=== X投稿スクリプト起動 ===")

    creds = load_credentials()
    if not all(creds.values()):
        logger.error("APIキーが未設定。.env ファイルを確認してください")
        return

    pending = find_pending_tweets()
    if not pending:
        logger.info("投稿予定ツイートなし")
        return

    client = get_client(creds)

    for i, tweet in enumerate(pending):
        if i > 0:
            logger.info("次の投稿まで30秒待機...")
            time.sleep(30)
        text = tweet["text"]
        quote_url = tweet.get("quote_tweet_url", "").strip()
        logger.info(f"投稿試行: id={tweet['id']} | {text[:40].strip()}...")
        try:
            if quote_url:
                m = re.search(r"/status/(\d+)", quote_url)
                if not m:
                    raise ValueError(f"quote_tweet_url からIDを抽出できません: {quote_url}")
                response = client.create_tweet(
                    text=text,
                    quote_tweet_id=int(m.group(1)),
                )
                logger.info(f"引用ツイートとして投稿: quote_id={m.group(1)}")
            else:
                response = client.create_tweet(text=text)
            tid = str(response.data["id"])
            update_queue(tweet["id"], tweet_id=tid)
            logger.info(f"✅ 投稿成功: tweet_id={tid}")
        except tweepy.TweepyException as e:
            logger.error(f"❌ 投稿失敗: id={tweet['id']} | {e}")
            update_queue(tweet["id"], error=str(e))


if __name__ == "__main__":
    main()

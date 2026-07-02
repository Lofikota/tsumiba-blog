CREATE TABLE IF NOT EXISTS tweet_queue (
  id INTEGER PRIMARY KEY,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT NOT NULL,
  tweet_type TEXT,
  text TEXT NOT NULL,
  original_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  posted_at TEXT,
  tweet_id TEXT,
  error TEXT,
  -- 同一スロットの重複投稿を構造レベルで防ぐ
  UNIQUE (scheduled_date, scheduled_time)
);

CREATE INDEX IF NOT EXISTS idx_status_date ON tweet_queue(status, scheduled_date, scheduled_time);

CREATE TABLE IF NOT EXISTS telegram_sessions (
  telegram_user_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


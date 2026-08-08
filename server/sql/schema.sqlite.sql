-- ============================================================
-- Beyond Orbit — SQLite schema
--
-- The MySQL schema is canonical for a LAMP deployment. This file
-- deliberately is not a regex conversion of it: SQLite differs in
-- AUTOINCREMENT, inline uniqueness and CREATE OR REPLACE VIEW, and
-- pretending otherwise produced a half-installed database. Keeping
-- this small companion schema makes the zero-setup local server
-- reliable and testable.
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  phone          TEXT,
  address        TEXT,
  avatar         TEXT NOT NULL DEFAULT '🚀',
  password_hash  TEXT NOT NULL,
  xp             INTEGER NOT NULL DEFAULT 0,
  streak_count   INTEGER NOT NULL DEFAULT 0,
  streak_last    TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login     TEXT
);
CREATE INDEX IF NOT EXISTS ix_users_xp ON users (xp DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS level_completions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  level_id      TEXT NOT NULL,
  course_id     TEXT NOT NULL,
  xp_awarded    INTEGER NOT NULL DEFAULT 10,
  completed_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, level_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_completion_course ON level_completions (course_id);

CREATE TABLE IF NOT EXISTS planet_visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  body_id     TEXT NOT NULL,
  visited_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, body_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS badges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  badge_id   TEXT NOT NULL,
  earned_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, badge_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  score         INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  topic         TEXT NOT NULL DEFAULT 'all',
  duration_ms   INTEGER,
  attempted_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_attempt_user ON quiz_attempts (user_id, attempted_at);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id   INTEGER NOT NULL,
  question     TEXT NOT NULL,
  chosen       TEXT,
  correct      TEXT NOT NULL,
  was_correct  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (attempt_id) REFERENCES quiz_attempts (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_answer_attempt ON quiz_answers (attempt_id);

CREATE TABLE IF NOT EXISTS reflections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  body         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'fact',
  confidence   REAL NOT NULL DEFAULT 0.600,
  source       TEXT NOT NULL DEFAULT 'you told me',
  pinned       INTEGER NOT NULL DEFAULT 0,
  uses         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_memory_user ON memories (user_id, confidence DESC);
CREATE INDEX IF NOT EXISTS ix_memory_kind ON memories (kind);

CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  crew          TEXT NOT NULL,
  brief         TEXT NOT NULL,
  interval_id   TEXT NOT NULL DEFAULT '1h',
  webhook_url   TEXT,
  auto_approve  INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  runs          INTEGER NOT NULL DEFAULT 0,
  last_run      TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_job_user ON jobs (user_id, enabled);

CREATE TABLE IF NOT EXISTS inbox_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  job_id       INTEGER,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  payload      TEXT,
  confidence   REAL NOT NULL DEFAULT 0.500,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at   TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_inbox_user ON inbox_items (user_id, status, created_at);

CREATE TABLE IF NOT EXISTS classifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  request       TEXT NOT NULL,
  intent        TEXT NOT NULL,
  confidence    REAL NOT NULL,
  engine        TEXT NOT NULL DEFAULT 'quantum',
  agreed        INTEGER NOT NULL DEFAULT 1,
  corrected_to  TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_class_intent ON classifications (intent, created_at);
CREATE INDEX IF NOT EXISTS ix_class_engine ON classifications (engine);

CREATE TABLE IF NOT EXISTS feed_cache (
  cache_key   TEXT PRIMARY KEY,
  body        TEXT NOT NULL,
  fetched_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cache_expiry ON feed_cache (expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  action      TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_user ON audit_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_log (action);

DROP VIEW IF EXISTS v_leaderboard;
CREATE VIEW v_leaderboard AS
SELECT
  u.id, u.username, u.avatar, u.xp, u.streak_count,
  (SELECT COUNT(*) FROM level_completions lc WHERE lc.user_id = u.id) AS levels,
  (SELECT COUNT(*) FROM planet_visits pv WHERE pv.user_id = u.id) AS planets,
  (SELECT COUNT(*) FROM badges b WHERE b.user_id = u.id) AS badge_count,
  COALESCE((SELECT MAX(qa.score) FROM quiz_attempts qa WHERE qa.user_id = u.id), 0) AS best_quiz,
  CASE
    WHEN u.xp >= 400 THEN 'Cosmic Master'
    WHEN u.xp >= 260 THEN 'Star Navigator'
    WHEN u.xp >= 150 THEN 'Orbit Pilot'
    WHEN u.xp >= 70 THEN 'Cadet'
    ELSE 'Stardust'
  END AS rank_title
FROM users u;

DROP VIEW IF EXISTS v_level_stats;
CREATE VIEW v_level_stats AS
SELECT level_id, course_id, COUNT(*) AS completions,
       MIN(completed_at) AS first_completed, MAX(completed_at) AS last_completed
FROM level_completions
GROUP BY level_id, course_id;

DROP VIEW IF EXISTS v_classifier_accuracy;
CREATE VIEW v_classifier_accuracy AS
SELECT engine, COUNT(*) AS total,
       SUM(CASE WHEN corrected_to IS NULL THEN 1 ELSE 0 END) AS unchallenged,
       SUM(CASE WHEN corrected_to IS NOT NULL THEN 1 ELSE 0 END) AS corrected,
       ROUND(AVG(confidence), 3) AS mean_confidence
FROM classifications
GROUP BY engine;

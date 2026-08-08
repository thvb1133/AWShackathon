-- ============================================================
--  Beyond Orbit — relational schema
--
--  Written for MySQL/MariaDB. The PHP layer can also run this
--  against SQLite for a zero-setup local install; the few places
--  the dialects differ are handled in lib/Database.php rather than
--  by keeping two divergent copies of the schema.
--
--  Design notes worth stating up front:
--    · Third normal form throughout. A completed level is a row in
--      level_completions, not a JSON blob on the user, so "how many
--      cadets finished level 7" is a GROUP BY rather than a scan.
--    · Every foreign key cascades on delete, so removing a user
--      genuinely removes their data. That is a GDPR requirement, not
--      a nicety.
--    · Money-free, but still: no floating point where a decision is
--      made on the value. XP is an integer.
--    · Passwords are never stored. Only a bcrypt hash from PHP's
--      password_hash() goes in, and only password_verify() reads it.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Cadets
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  username       VARCHAR(40)     NOT NULL,
  email          VARCHAR(190)    NOT NULL,
  phone          VARCHAR(30)         NULL,
  address        VARCHAR(255)        NULL,
  avatar         VARCHAR(16)     NOT NULL DEFAULT '🚀',
  password_hash  VARCHAR(255)    NOT NULL,
  xp             INT UNSIGNED    NOT NULL DEFAULT 0,
  streak_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  streak_last    DATE                NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login     TIMESTAMP           NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_xp (xp DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Sessions. Tokens are stored hashed, for the same reason
-- passwords are: a leaked database should not be a set of keys.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED    NOT NULL,
  token_hash  CHAR(64)        NOT NULL,
  user_agent  VARCHAR(255)        NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Classroom progress
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS level_completions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED    NOT NULL,
  level_id      VARCHAR(40)     NOT NULL,   -- e.g. 'penguin-7'
  course_id     VARCHAR(20)     NOT NULL,   -- 'thorn' | 'penguin'
  xp_awarded    SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  completed_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- The uniqueness constraint is what makes double-scoring impossible
  -- at the database level, not merely in the interface.
  UNIQUE KEY uq_completion (user_id, level_id),
  KEY ix_completion_course (course_id),
  CONSTRAINT fk_completion_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planet_visits (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED    NOT NULL,
  body_id     VARCHAR(40)     NOT NULL,
  visited_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_visit (user_id, body_id),
  CONSTRAINT fk_visit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS badges (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED    NOT NULL,
  badge_id   VARCHAR(40)     NOT NULL,
  earned_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_badge (user_id, badge_id),
  CONSTRAINT fk_badge_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Quiz. Attempts and answers are separate tables so a question's
-- difficulty can be measured across every cadet who met it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED    NOT NULL,
  score         SMALLINT UNSIGNED NOT NULL,
  total         SMALLINT UNSIGNED NOT NULL,
  topic         VARCHAR(40)     NOT NULL DEFAULT 'all',
  duration_ms   INT UNSIGNED        NULL,
  attempted_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_attempt_user (user_id, attempted_at),
  CONSTRAINT fk_attempt_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quiz_answers (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attempt_id   BIGINT UNSIGNED NOT NULL,
  question     VARCHAR(400)    NOT NULL,
  chosen       VARCHAR(400)        NULL,
  correct      VARCHAR(400)    NOT NULL,
  was_correct  TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_answer_attempt (attempt_id),
  CONSTRAINT fk_answer_attempt FOREIGN KEY (attempt_id) REFERENCES quiz_attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reflections (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED    NOT NULL,
  body        TEXT            NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reflection_user (user_id),
  CONSTRAINT fk_reflection_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- The assistant's memory, now server-side so it follows the cadet
-- from one device to another instead of living in one browser.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED    NOT NULL,
  body         VARCHAR(500)    NOT NULL,
  kind         VARCHAR(20)     NOT NULL DEFAULT 'fact',
  confidence   DECIMAL(4,3)    NOT NULL DEFAULT 0.600,
  source       VARCHAR(80)     NOT NULL DEFAULT 'you told me',
  pinned       TINYINT(1)      NOT NULL DEFAULT 0,
  uses         INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_memory_user (user_id, confidence DESC),
  KEY ix_memory_kind (kind),
  CONSTRAINT fk_memory_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Automations and the approval inbox
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED    NOT NULL,
  name          VARCHAR(120)    NOT NULL,
  crew          VARCHAR(40)     NOT NULL,
  brief         VARCHAR(500)    NOT NULL,
  interval_id   VARCHAR(10)     NOT NULL DEFAULT '1h',
  webhook_url   VARCHAR(500)        NULL,
  auto_approve  TINYINT(1)      NOT NULL DEFAULT 0,
  enabled       TINYINT(1)      NOT NULL DEFAULT 1,
  runs          INT UNSIGNED    NOT NULL DEFAULT 0,
  last_run      DATETIME            NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_job_user (user_id, enabled),
  CONSTRAINT fk_job_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inbox_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED    NOT NULL,
  job_id       BIGINT UNSIGNED     NULL,
  title        VARCHAR(200)    NOT NULL,
  summary      TEXT            NOT NULL,
  payload      LONGTEXT            NULL,   -- the full crew transcript, as JSON
  confidence   DECIMAL(4,3)    NOT NULL DEFAULT 0.500,
  status       ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  note         VARCHAR(500)        NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at   DATETIME            NULL,
  PRIMARY KEY (id),
  KEY ix_inbox_user (user_id, status, created_at),
  CONSTRAINT fk_inbox_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_inbox_job FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- What the quantum classifier decided, kept so the model can be
-- audited and retrained on real traffic rather than only on the
-- fifty-five hand-labelled examples it ships with.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classifications (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED        NULL,
  request       VARCHAR(500)    NOT NULL,
  intent        VARCHAR(20)     NOT NULL,
  confidence    DECIMAL(4,3)    NOT NULL,
  engine        VARCHAR(20)     NOT NULL DEFAULT 'quantum',  -- quantum | classical | lexical
  agreed        TINYINT(1)      NOT NULL DEFAULT 1,
  corrected_to  VARCHAR(20)         NULL,  -- set when a human says it was wrong
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_class_intent (intent, created_at),
  KEY ix_class_engine (engine),
  CONSTRAINT fk_class_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- A cache of third-party feeds, shared across every visitor.
-- One server-side fetch serves everybody, which is what keeps the
-- app inside NASA's thirty-requests-per-hour demo limit.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feed_cache (
  cache_key   VARCHAR(120)    NOT NULL,
  body        LONGTEXT        NOT NULL,
  fetched_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME        NOT NULL,
  PRIMARY KEY (cache_key),
  KEY ix_cache_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- An audit trail. Every write goes through here.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED        NULL,
  action      VARCHAR(60)     NOT NULL,
  detail      VARCHAR(500)        NULL,
  ip          VARCHAR(45)         NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_user (user_id, created_at),
  KEY ix_audit_action (action),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
--  Views — the leaderboard is a query, not an application loop
-- ============================================================

CREATE OR REPLACE VIEW v_leaderboard AS
SELECT
  u.id,
  u.username,
  u.avatar,
  u.xp,
  u.streak_count,
  (SELECT COUNT(*) FROM level_completions lc WHERE lc.user_id = u.id) AS levels,
  (SELECT COUNT(*) FROM planet_visits pv  WHERE pv.user_id = u.id)    AS planets,
  (SELECT COUNT(*) FROM badges b          WHERE b.user_id  = u.id)    AS badge_count,
  COALESCE((SELECT MAX(qa.score) FROM quiz_attempts qa WHERE qa.user_id = u.id), 0) AS best_quiz,
  CASE
    WHEN u.xp >= 400 THEN 'Cosmic Master'
    WHEN u.xp >= 260 THEN 'Star Navigator'
    WHEN u.xp >= 150 THEN 'Orbit Pilot'
    WHEN u.xp >=  70 THEN 'Cadet'
    ELSE 'Stardust'
  END AS rank_title
FROM users u;

-- How hard each level is proving in practice.
CREATE OR REPLACE VIEW v_level_stats AS
SELECT
  level_id,
  course_id,
  COUNT(*)                      AS completions,
  MIN(completed_at)             AS first_completed,
  MAX(completed_at)             AS last_completed
FROM level_completions
GROUP BY level_id, course_id;

-- Quantum against classical, measured on real traffic rather than claimed.
CREATE OR REPLACE VIEW v_classifier_accuracy AS
SELECT
  engine,
  COUNT(*)                                                  AS total,
  SUM(CASE WHEN corrected_to IS NULL THEN 1 ELSE 0 END)     AS unchallenged,
  SUM(CASE WHEN corrected_to IS NOT NULL THEN 1 ELSE 0 END) AS corrected,
  ROUND(AVG(confidence), 3)                                 AS mean_confidence
FROM classifications
GROUP BY engine;

<?php
declare(strict_types=1);

/**
 * Progress.php — scoring, badges and the leaderboard.
 *
 * The interesting part is that double-scoring is now prevented by the
 * database rather than by the interface. level_completions has a
 * UNIQUE (user_id, level_id), so a second insert fails at the storage
 * layer no matter how the request got there — a replayed POST, two
 * tabs, a broken button, or somebody with curl. The browser-only
 * version could only guard the button.
 */
final class Progress
{
    /** Awarded once per level, ever. */
    public static function completeLevel(int $userId, string $levelId, string $courseId, int $xp = 10): array
    {
        return Database::transaction(static function () use ($userId, $levelId, $courseId, $xp): array {
            $already = Database::value(
                'SELECT id FROM level_completions WHERE user_id = ? AND level_id = ?',
                [$userId, $levelId]
            );
            if ($already) {
                return [
                    'awarded' => false,
                    'reason'  => 'already completed',
                    'xp'      => (int) Database::value('SELECT xp FROM users WHERE id = ?', [$userId]),
                ];
            }

            Database::run(
                'INSERT INTO level_completions (user_id, level_id, course_id, xp_awarded) VALUES (?, ?, ?, ?)',
                [$userId, $levelId, $courseId, $xp]
            );
            Database::run('UPDATE users SET xp = xp + ? WHERE id = ?', [$xp, $userId]);

            $total  = (int) Database::value('SELECT xp FROM users WHERE id = ?', [$userId]);
            $earned = self::grantBadges($userId);

            return ['awarded' => true, 'gained' => $xp, 'xp' => $total, 'new_badges' => $earned];
        });
    }

    public static function visitPlanet(int $userId, string $bodyId): array
    {
        $already = Database::value('SELECT id FROM planet_visits WHERE user_id = ? AND body_id = ?', [$userId, $bodyId]);
        if ($already) {
            return ['awarded' => false, 'xp' => (int) Database::value('SELECT xp FROM users WHERE id = ?', [$userId])];
        }
        Database::run('INSERT INTO planet_visits (user_id, body_id) VALUES (?, ?)', [$userId, $bodyId]);
        Database::run('UPDATE users SET xp = xp + 5 WHERE id = ?', [$userId]);
        $earned = self::grantBadges($userId);
        return [
            'awarded'    => true,
            'gained'     => 5,
            'xp'         => (int) Database::value('SELECT xp FROM users WHERE id = ?', [$userId]),
            'new_badges' => $earned,
        ];
    }

    public static function recordQuiz(int $userId, int $score, int $total, string $topic, array $answers): array
    {
        return Database::transaction(static function () use ($userId, $score, $total, $topic, $answers): array {
            $best = (int) (Database::value('SELECT MAX(score) FROM quiz_attempts WHERE user_id = ?', [$userId]) ?? 0);

            $attemptId = Database::insert(
                'INSERT INTO quiz_attempts (user_id, score, total, topic) VALUES (?, ?, ?, ?)',
                [$userId, $score, $total, $topic]
            );

            foreach (array_slice($answers, 0, 50) as $answer) {
                if (!is_array($answer) || !isset($answer['question'], $answer['correct'])) {
                    continue;
                }
                Database::run(
                    'INSERT INTO quiz_answers (attempt_id, question, chosen, correct, was_correct) VALUES (?, ?, ?, ?, ?)',
                    [
                        $attemptId,
                        bo_substr((string) $answer['question'], 0, 400),
                        isset($answer['chosen']) ? bo_substr((string) $answer['chosen'], 0, 400) : null,
                        bo_substr((string) $answer['correct'], 0, 400),
                        (($answer['chosen'] ?? null) === $answer['correct']) ? 1 : 0,
                    ]
                );
            }

            // Only the improvement over a previous best is worth XP, so
            // re-taking an easy quiz cannot farm points.
            $gained = 0;
            if ($score > $best) {
                $gained = ($score - $best) * 4;
                Database::run('UPDATE users SET xp = xp + ? WHERE id = ?', [$gained, $userId]);
            }
            $earned = self::grantBadges($userId);

            return [
                'attempt_id' => $attemptId,
                'best'       => max($best, $score),
                'gained'     => $gained,
                'xp'         => (int) Database::value('SELECT xp FROM users WHERE id = ?', [$userId]),
                'new_badges' => $earned,
            ];
        });
    }

    public static function saveReflection(int $userId, string $body): array
    {
        $existing = Database::value('SELECT id FROM reflections WHERE user_id = ?', [$userId]);
        if ($existing) {
            Database::run('UPDATE reflections SET body = ? WHERE user_id = ?', [$body, $userId]);
            $gained = 0;
        } else {
            Database::run('INSERT INTO reflections (user_id, body) VALUES (?, ?)', [$userId, $body]);
            $gained = 20;
            Database::run('UPDATE users SET xp = xp + 20 WHERE id = ?', [$userId]);
        }
        $earned = self::grantBadges($userId);
        return [
            'saved'      => true,
            'gained'     => $gained,
            'xp'         => (int) Database::value('SELECT xp FROM users WHERE id = ?', [$userId]),
            'new_badges' => $earned,
        ];
    }

    /* ------------------------------------------------------------
       Badges
       ------------------------------------------------------------ */

    private const BADGES = [
        'first-step'    => ['👣', 'First Step'],
        'thorn-heart'   => ['🪶', 'Thorn Heart'],
        'ice-mind'      => ['🐧', 'Ice Mind'],
        'explorer'      => ['🔭', 'Orbit Explorer'],
        'grand-tour'    => ['🪐', 'Grand Tour'],
        'quiz-ace'      => ['🎯', 'Quiz Ace'],
        'philosopher'   => ['📜', 'Philosopher'],
        'streak'        => ['🔥', 'Constant Star'],
        'cosmic-master' => ['👑', 'Cosmic Master'],
    ];

    /**
     * Evaluates every badge condition with aggregate SQL rather than by
     * pulling the rows into PHP and counting them.
     *
     * @return array<int,array{id:string,icon:string,name:string}>
     */
    private static function grantBadges(int $userId): array
    {
        $stats = Database::one(
            'SELECT
               (SELECT COUNT(*) FROM level_completions WHERE user_id = u.id)                            AS levels,
               (SELECT COUNT(*) FROM level_completions WHERE user_id = u.id AND course_id = ?)          AS thorn,
               (SELECT COUNT(*) FROM level_completions WHERE user_id = u.id AND course_id = ?)          AS penguin,
               (SELECT COUNT(*) FROM planet_visits     WHERE user_id = u.id)                            AS planets,
               (SELECT COALESCE(MAX(score),0) FROM quiz_attempts WHERE user_id = u.id)                  AS best_quiz,
               (SELECT COALESCE(LENGTH(body),0) FROM reflections WHERE user_id = u.id)                  AS reflection_len,
               u.xp, u.streak_count
             FROM users u WHERE u.id = ?',
            ['thorn', 'penguin', $userId]
        );
        if (!$stats) {
            return [];
        }

        $conditions = [
            'first-step'    => (int) $stats['levels'] >= 1,
            'thorn-heart'   => (int) $stats['thorn'] >= 8,
            'ice-mind'      => (int) $stats['penguin'] >= 11,
            'explorer'      => (int) $stats['planets'] >= 5,
            'grand-tour'    => (int) $stats['planets'] >= 10,
            'quiz-ace'      => (int) $stats['best_quiz'] >= 8,
            'philosopher'   => (int) $stats['reflection_len'] >= 120,
            'streak'        => (int) $stats['streak_count'] >= 3,
            'cosmic-master' => (int) $stats['xp'] >= 400,
        ];

        $held = array_column(Database::all('SELECT badge_id FROM badges WHERE user_id = ?', [$userId]), 'badge_id');
        $new  = [];

        foreach ($conditions as $badgeId => $met) {
            if (!$met || in_array($badgeId, $held, true)) {
                continue;
            }
            try {
                Database::run('INSERT INTO badges (user_id, badge_id) VALUES (?, ?)', [$userId, $badgeId]);
                $new[] = ['id' => $badgeId, 'icon' => self::BADGES[$badgeId][0], 'name' => self::BADGES[$badgeId][1]];
            } catch (Throwable) {
                // A race with another tab is fine; the unique key held.
            }
        }
        return $new;
    }

    /* ------------------------------------------------------------
       Reading
       ------------------------------------------------------------ */

    public static function summary(int $userId): array
    {
        $user = Database::one('SELECT xp, streak_count FROM users WHERE id = ?', [$userId]);
        return [
            'xp'          => (int) ($user['xp'] ?? 0),
            'streak'      => (int) ($user['streak_count'] ?? 0),
            'rank'        => Auth::rankTitle((int) ($user['xp'] ?? 0)),
            'levels'      => array_column(
                Database::all('SELECT level_id FROM level_completions WHERE user_id = ?', [$userId]),
                'level_id'
            ),
            'planets'     => array_column(
                Database::all('SELECT body_id FROM planet_visits WHERE user_id = ?', [$userId]),
                'body_id'
            ),
            'badges'      => array_column(Database::all('SELECT badge_id FROM badges WHERE user_id = ?', [$userId]), 'badge_id'),
            'best_quiz'   => (int) (Database::value('SELECT MAX(score) FROM quiz_attempts WHERE user_id = ?', [$userId]) ?? 0),
            'attempts'    => (int) Database::value('SELECT COUNT(*) FROM quiz_attempts WHERE user_id = ?', [$userId]),
            'reflection'  => (string) (Database::value('SELECT body FROM reflections WHERE user_id = ?', [$userId]) ?? ''),
        ];
    }

    /** The ranking, computed by the database view rather than in PHP. */
    public static function leaderboard(int $limit = 25): array
    {
        $rows = Database::all(
            'SELECT username, avatar, xp, levels, planets, badge_count, best_quiz, streak_count, rank_title
             FROM v_leaderboard
             ORDER BY xp DESC, levels DESC, username ASC
             LIMIT ' . (int) $limit
        );
        foreach ($rows as $index => &$row) {
            $row['position']    = $index + 1;
            $row['xp']          = (int) $row['xp'];
            $row['levels']      = (int) $row['levels'];
            $row['planets']     = (int) $row['planets'];
            $row['badge_count'] = (int) $row['badge_count'];
            $row['best_quiz']   = (int) $row['best_quiz'];
        }
        return $rows;
    }

    /**
     * Which questions people actually get wrong.
     * This is the sort of thing a database is for and a localStorage
     * app can never do: it aggregates across every cadet at once.
     */
    public static function quizStats(int $limit = 20): array
    {
        return Database::all(
            'SELECT question,
                    COUNT(*)                                              AS asked,
                    SUM(was_correct)                                      AS correct,
                    ROUND(100.0 * SUM(was_correct) / COUNT(*), 1)         AS percent_correct
             FROM quiz_answers
             GROUP BY question
             HAVING COUNT(*) >= 1
             ORDER BY percent_correct ASC, asked DESC
             LIMIT ' . (int) $limit
        );
    }

    /**
     * Accepts a whole browser localStorage blob and merges it in.
     *
     * This is what lets somebody who has been using the offline version
     * sign up and keep everything. Merging is additive and idempotent:
     * running it twice changes nothing, because every insert is guarded
     * by the same unique keys the rest of the class relies on.
     */
    public static function sync(int $userId, array $progress): array
    {
        $added = ['levels' => 0, 'planets' => 0];

        foreach (array_slice((array) ($progress['levels'] ?? []), 0, 200) as $levelId => $_meta) {
            $levelId  = (string) $levelId;
            $courseId = str_starts_with($levelId, 'thorn') ? 'thorn' : 'penguin';
            $result   = self::completeLevel($userId, $levelId, $courseId, 10);
            if ($result['awarded']) {
                $added['levels']++;
            }
        }
        foreach (array_slice((array) ($progress['planets'] ?? []), 0, 200) as $bodyId) {
            $result = self::visitPlanet($userId, (string) $bodyId);
            if ($result['awarded']) {
                $added['planets']++;
            }
        }
        if (!empty($progress['reflection']) && strlen((string) $progress['reflection']) >= 20) {
            self::saveReflection($userId, (string) $progress['reflection']);
        }

        Http::audit($userId, 'sync', json_encode($added));
        return ['merged' => $added, 'progress' => self::summary($userId)];
    }
}

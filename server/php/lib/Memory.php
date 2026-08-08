<?php
declare(strict_types=1);

/**
 * Memory.php — the assistant's memory, server-side.
 *
 * Same rules as the browser version in assets/js/memory.js: confidence
 * that decays with neglect, reinforcement instead of duplication, and a
 * forget that really deletes. The difference is that this copy follows
 * the cadet between devices, and the decay is computed in SQL so a
 * thousand entries cost one query rather than a thousand.
 */
final class Memory
{
    private const MAX_PER_USER = 500;

    /**
     * Everything remembered, with live confidence.
     *
     * Decay is a half-life that lengthens each time an entry proves
     * useful, so a fact relied on twenty times does not become doubtful
     * merely because a month has passed. Pinned entries never decay.
     */
    public static function all(int $userId): array
    {
        $rows = Database::all(
            'SELECT id, body, kind, confidence, source, pinned, uses, created_at, updated_at
             FROM memories WHERE user_id = ? ORDER BY pinned DESC, confidence DESC, updated_at DESC',
            [$userId]
        );

        foreach ($rows as &$row) {
            $row['id']         = (int) $row['id'];
            $row['uses']       = (int) $row['uses'];
            $row['pinned']     = (bool) $row['pinned'];
            $row['confidence'] = (float) $row['confidence'];
            $row['live']       = self::liveConfidence($row);
        }
        unset($row);

        usort($rows, static fn (array $a, array $b): int => $b['live'] <=> $a['live']);
        return $rows;
    }

    private static function liveConfidence(array $row): float
    {
        if ($row['pinned']) {
            return round($row['confidence'], 3);
        }
        $ageDays  = max(0.0, (time() - strtotime((string) $row['updated_at'])) / 86400);
        $halfLife = 60 + $row['uses'] * 30;
        $decayed  = $row['confidence'] * (2 ** (-$ageDays / $halfLife));
        $floor    = min($row['confidence'], 0.25 + min(0.5, $row['uses'] * 0.06));
        return round(max($floor, $decayed), 3);
    }

    /**
     * Remembers something, reinforcing a near-duplicate rather than
     * storing it twice.
     */
    public static function remember(int $userId, array $input): array
    {
        $body = trim((string) $input['body']);
        $kind = (string) ($input['kind'] ?? 'fact');

        $existing = self::findSimilar($userId, $body, $kind);
        if ($existing) {
            Database::run(
                'UPDATE memories
                    SET confidence = ?, uses = uses + 1, body = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND user_id = ?',
                [
                    min(1.0, (float) $existing['confidence'] + 0.15),
                    strlen($body) > strlen((string) $existing['body']) ? $body : $existing['body'],
                    $existing['id'],
                    $userId,
                ]
            );
            return ['id' => (int) $existing['id'], 'reinforced' => true];
        }

        $id = Database::insert(
            'INSERT INTO memories (user_id, body, kind, confidence, source) VALUES (?, ?, ?, ?, ?)',
            [
                $userId,
                $body,
                $kind,
                max(0.05, min(1.0, (float) ($input['confidence'] ?? 0.6))),
                (string) ($input['source'] ?? 'you told me'),
            ]
        );

        self::prune($userId);
        Http::audit($userId, 'memory_add', bo_substr($body, 0, 80));
        return ['id' => $id, 'reinforced' => false];
    }

    /**
     * A restatement is not a new fact. Overlap is measured on the words
     * that carry meaning, which is cheap and catches the common case of
     * somebody saying the same thing slightly differently.
     */
    private static function findSimilar(int $userId, string $body, string $kind): ?array
    {
        $candidates = Database::all(
            'SELECT id, body, confidence FROM memories WHERE user_id = ? AND kind = ?',
            [$userId, $kind]
        );
        $wanted = self::tokens($body);
        if (!$wanted) {
            return null;
        }

        foreach ($candidates as $candidate) {
            $other = self::tokens((string) $candidate['body']);
            if (!$other) {
                continue;
            }
            $shared = count(array_intersect($wanted, $other));
            if ($shared / min(count($wanted), count($other)) > 0.7) {
                return $candidate;
            }
        }
        return null;
    }

    /** @return array<int,string> */
    private static function tokens(string $text): array
    {
        $stop = ['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'my', 'we', 'our', 'you', 'it', 'that', 'this', 'with', 'at', 'be', 'as', 'by'];
        preg_match_all("/[a-z0-9']+/", strtolower($text), $matches);
        return array_values(array_unique(array_filter(
            $matches[0],
            static fn (string $word): bool => strlen($word) > 2 && !in_array($word, $stop, true)
        )));
    }

    /** The forget button. Permanent, and scoped to the owner. */
    public static function forget(int $userId, int $id): bool
    {
        $removed = Database::affected('DELETE FROM memories WHERE id = ? AND user_id = ?', [$id, $userId]) > 0;
        if ($removed) {
            Http::audit($userId, 'memory_forget', (string) $id);
        }
        return $removed;
    }

    /** Over the cap, the least confident go — not the oldest. */
    private static function prune(int $userId): void
    {
        $count = (int) Database::value('SELECT COUNT(*) FROM memories WHERE user_id = ?', [$userId]);
        if ($count <= self::MAX_PER_USER) {
            return;
        }
        $excess = $count - self::MAX_PER_USER;
        Database::run(
            'DELETE FROM memories WHERE id IN (
               SELECT id FROM (
                 SELECT id FROM memories
                 WHERE user_id = ? AND pinned = 0
                 ORDER BY confidence ASC, updated_at ASC
                 LIMIT ' . $excess . '
               ) AS doomed
             )',
            [$userId]
        );
    }

    /**
     * The entries worth putting in front of the assistant for a request.
     * Identity, business and goals always count as relevant; everything
     * else has to overlap with what was actually asked.
     */
    public static function relevant(int $userId, string $request, int $limit = 8): array
    {
        $wanted = self::tokens($request);
        $scored = [];

        foreach (self::all($userId) as $entry) {
            if ($entry['live'] < 0.35) {
                continue;
            }
            $words   = self::tokens((string) $entry['body']);
            $overlap = $words ? count(array_intersect($words, $wanted)) : 0;
            $always  = in_array($entry['kind'], ['identity', 'business', 'goal'], true) ? 0.55 : 0.0;
            $score   = ($overlap / max(1, min(count($words), 6)) + $always) * $entry['live'];
            if ($score > 0.08) {
                $entry['relevance'] = round($score, 3);
                $scored[] = $entry;
            }
        }

        usort($scored, static fn (array $a, array $b): int => $b['relevance'] <=> $a['relevance']);
        $chosen = array_slice($scored, 0, $limit);

        if ($chosen) {
            $ids = implode(',', array_map(static fn (array $e): int => (int) $e['id'], $chosen));
            Database::run("UPDATE memories SET uses = uses + 1 WHERE id IN ($ids) AND user_id = ?", [$userId]);
        }
        return $chosen;
    }
}

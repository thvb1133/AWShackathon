<?php
declare(strict_types=1);

/**
 * Auth.php — registration, login, sessions.
 *
 * The browser-only version of this app hashed passwords with a small
 * non-cryptographic function and said plainly that it was obfuscation
 * rather than security, because there was no server to authenticate
 * against. There is one now, so this does the real thing:
 *
 *   · password_hash() with bcrypt, cost configurable
 *   · password_verify(), which is constant-time
 *   · session tokens from random_bytes(), stored only as a SHA-256
 *     hash, so a leaked database yields no usable tokens
 *   · a deliberate delay on failed logins, and a per-address attempt
 *     limit, to make guessing expensive
 */
final class Auth
{
    /* ------------------------------------------------------------
       Registration
       ------------------------------------------------------------ */

    public static function register(array $input): array
    {
        $username = trim((string) $input['username']);
        $email    = strtolower(trim((string) $input['email']));

        if (Database::value('SELECT id FROM users WHERE username = ?', [$username])) {
            Http::fail('That cadet name is already orbiting. Choose another.', 409, ['fields' => ['username' => 'Already taken.']]);
        }
        if (Database::value('SELECT id FROM users WHERE email = ?', [$email])) {
            Http::fail('That email is already registered.', 409, ['fields' => ['email' => 'Already registered.']]);
        }

        $hash = password_hash((string) $input['password'], PASSWORD_BCRYPT, [
            'cost' => Config::get()['auth']['bcrypt_cost'],
        ]);

        $id = Database::insert(
            'INSERT INTO users (username, email, phone, address, avatar, password_hash)
             VALUES (?, ?, ?, ?, ?, ?)',
            [
                $username,
                $email,
                $input['phone']   ?? null,
                $input['address'] ?? null,
                $input['avatar']  ?: '🚀',
                $hash,
            ]
        );

        Http::audit($id, 'register', $username);
        return self::startSession($id);
    }

    /* ------------------------------------------------------------
       Login
       ------------------------------------------------------------ */

    public static function login(string $username, string $password): array
    {
        self::throttle();

        $user = Database::one(
            'SELECT id, username, password_hash FROM users WHERE username = ? OR email = ?',
            [trim($username), strtolower(trim($username))]
        );

        // Verify against a dummy hash when the user does not exist, so the
        // response takes the same time either way and cannot be used to
        // enumerate which cadet names are registered.
        $hash = $user['password_hash'] ?? '$2y$11$usesomesillystringfoxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

        if (!password_verify($password, $hash) || !$user) {
            self::recordFailure();
            usleep(350000);
            Http::fail('Wrong name or password. The airlock stays shut.', 401);
        }

        // Re-hash if the cost factor has been raised since they signed up.
        if (password_needs_rehash($hash, PASSWORD_BCRYPT, ['cost' => Config::get()['auth']['bcrypt_cost']])) {
            Database::run('UPDATE users SET password_hash = ? WHERE id = ?', [
                password_hash($password, PASSWORD_BCRYPT, ['cost' => Config::get()['auth']['bcrypt_cost']]),
                $user['id'],
            ]);
        }

        Database::run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [$user['id']]);
        self::touchStreak((int) $user['id']);
        Http::audit((int) $user['id'], 'login', $user['username']);

        return self::startSession((int) $user['id']);
    }

    /* ------------------------------------------------------------
       Sessions
       ------------------------------------------------------------ */

    private static function startSession(int $userId): array
    {
        $token = bin2hex(random_bytes(32));
        $days  = Config::get()['auth']['session_days'];

        Database::run(
            'INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES (?, ?, ?, ?)',
            [$userId, hash('sha256', $token), Http::userAgent(), date('Y-m-d H:i:s', time() + $days * 86400)]
        );

        // Opportunistically clear anything long expired.
        Database::run('DELETE FROM sessions WHERE expires_at < ?', [date('Y-m-d H:i:s')]);

        return ['token' => $token, 'user' => self::profile($userId), 'expires_in_days' => $days];
    }

    /** The user behind the bearer token, or null. */
    public static function current(): ?array
    {
        $token = Http::bearer();
        if (!$token) {
            return null;
        }
        $row = Database::one(
            'SELECT u.* FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > ?',
            [hash('sha256', $token), date('Y-m-d H:i:s')]
        );
        return $row ?: null;
    }

    /** The same, but refuses the request when nobody is logged in. */
    public static function require(): array
    {
        $user = self::current();
        if (!$user) {
            Http::fail('You must be logged in for that.', 401);
        }
        return $user;
    }

    public static function logout(): void
    {
        $token = Http::bearer();
        if ($token) {
            Database::run('DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', $token)]);
        }
    }

    /* ------------------------------------------------------------
       Profile
       ------------------------------------------------------------ */

    public static function profile(int $userId): array
    {
        $row = Database::one(
            'SELECT id, username, email, phone, address, avatar, xp, streak_count, streak_last, created_at, last_login
             FROM users WHERE id = ?',
            [$userId]
        );
        if (!$row) {
            Http::fail('No such cadet.', 404);
        }
        $row['id']           = (int) $row['id'];
        $row['xp']           = (int) $row['xp'];
        $row['streak_count'] = (int) $row['streak_count'];
        $row['rank']         = self::rankTitle($row['xp']);
        return $row;
    }

    public static function rankTitle(int $xp): string
    {
        return match (true) {
            $xp >= 400 => 'Cosmic Master',
            $xp >= 260 => 'Star Navigator',
            $xp >= 150 => 'Orbit Pilot',
            $xp >= 70  => 'Cadet',
            default    => 'Stardust',
        };
    }

    private static function touchStreak(int $userId): void
    {
        $row = Database::one('SELECT streak_count, streak_last FROM users WHERE id = ?', [$userId]);
        $today     = date('Y-m-d');
        $yesterday = date('Y-m-d', strtotime('-1 day'));
        $last      = $row['streak_last'] ?? null;

        if ($last === $today) {
            return;
        }
        $count = ($last === $yesterday) ? ((int) $row['streak_count'] + 1) : 1;
        Database::run('UPDATE users SET streak_count = ?, streak_last = ? WHERE id = ?', [$count, $today, $userId]);
    }

    /* ------------------------------------------------------------
       Brute force resistance
       ------------------------------------------------------------ */

    private static function throttle(): void
    {
        $since = date('Y-m-d H:i:s', time() - 900);
        $fails = (int) Database::value(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'login_failed' AND ip = ? AND created_at > ?",
            [Http::ip(), $since]
        );
        if ($fails >= 10) {
            Http::fail('Too many failed attempts from this address. Wait fifteen minutes.', 429);
        }
    }

    private static function recordFailure(): void
    {
        Http::audit(null, 'login_failed', Http::ip());
    }
}

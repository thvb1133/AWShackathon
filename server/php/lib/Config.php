<?php
declare(strict_types=1);

/* University PHP builds sometimes omit mbstring. User input in this
   application is still UTF-8, so prefer multibyte operations where
   available and fall back safely instead of making the whole API die
   on a harmless validation length check. */
if (!function_exists('bo_strlen')) {
    function bo_strlen(string $value): int
    {
        return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
    }
}
if (!function_exists('bo_substr')) {
    function bo_substr(string $value, int $start, ?int $length = null): string
    {
        if (function_exists('mb_substr')) {
            return $length === null
                ? mb_substr($value, $start, null, 'UTF-8')
                : mb_substr($value, $start, $length, 'UTF-8');
        }
        return $length === null ? substr($value, $start) : substr($value, $start, $length);
    }
}

/**
 * Config.php — one place that decides how the server behaves.
 *
 * Everything can be overridden by an environment variable, so the same
 * code runs on a marker's LAMP box, in Docker, and on a laptop with no
 * MySQL at all. Nothing secret is committed: the defaults are
 * development values, and BO_DB_PASS has no default worth stealing.
 */
final class Config
{
    private static ?array $config = null;

    public static function get(): array
    {
        if (self::$config !== null) {
            return self::$config;
        }

        self::loadDotEnv(dirname(__DIR__, 2) . '/.env');

        // SQLite unless MySQL is explicitly asked for. That way a fresh
        // clone runs with no database server installed at all.
        $driver = self::env('BO_DB_DRIVER', 'sqlite');

        self::$config = [
            'db' => [
                'driver' => $driver,
                'host'   => self::env('BO_DB_HOST', '127.0.0.1'),
                'port'   => (int) self::env('BO_DB_PORT', '3306'),
                'name'   => self::env('BO_DB_NAME', 'beyond_orbit'),
                'user'   => self::env('BO_DB_USER', 'orbit'),
                'pass'   => self::env('BO_DB_PASS', ''),
                'path'   => self::env('BO_DB_PATH', dirname(__DIR__, 2) . '/data/beyond_orbit.sqlite'),
            ],
            'auth' => [
                // Sessions last a fortnight, which is long enough to be
                // convenient and short enough that a stolen token expires.
                'session_days' => (int) self::env('BO_SESSION_DAYS', '14'),
                'bcrypt_cost'  => (int) self::env('BO_BCRYPT_COST', '11'),
            ],
            'cors' => [
                // Comma-separated. '*' is fine for a coursework demo and
                // wrong for anything real, so it is a setting, not a constant.
                'origins' => array_map('trim', explode(',', self::env('BO_CORS_ORIGINS', '*'))),
            ],
            'nasa' => [
                'key' => self::env('BO_NASA_KEY', 'DEMO_KEY'),
            ],
            'python' => [
                // Where the machine learning service lives, if it is running.
                'url' => rtrim(self::env('BO_PYTHON_URL', 'http://127.0.0.1:8000'), '/'),
            ],
            'rate' => [
                'per_minute' => (int) self::env('BO_RATE_PER_MINUTE', '120'),
            ],
            'debug' => self::env('BO_DEBUG', '0') === '1',
        ];

        return self::$config;
    }

    public static function env(string $key, string $default = ''): string
    {
        $value = getenv($key);
        if ($value === false || $value === '') {
            $value = $_ENV[$key] ?? $_SERVER[$key] ?? $default;
        }
        return (string) $value;
    }

    /** A deliberately tiny .env reader — no dependency for four lines of parsing. */
    private static function loadDotEnv(string $path): void
    {
        if (!is_readable($path)) {
            return;
        }
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $key   = trim($key);
            $value = trim($value, " \t\n\r\0\x0B\"'");
            if (getenv($key) === false) {
                putenv("$key=$value");
                $_ENV[$key] = $value;
            }
        }
    }

    /** For tests, which need to point at a scratch database. */
    public static function override(array $config): void
    {
        self::$config = array_replace_recursive(self::get(), $config);
    }
}

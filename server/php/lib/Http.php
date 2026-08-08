<?php
declare(strict_types=1);

/**
 * Http.php — request parsing, responses, CORS, rate limiting and the
 * validation helpers every endpoint shares.
 *
 * The rule this file exists to enforce: an endpoint never touches
 * $_POST or $_GET directly, and never echoes anything but JSON. If
 * input is not validated here, it does not reach the database.
 */
final class Http
{
    private static ?array $body = null;

    /* ------------------------------------------------------------
       Request
       ------------------------------------------------------------ */

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    /** The JSON body, decoded once. Form posts are accepted too. */
    public static function body(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }
        $raw = file_get_contents('php://input') ?: '';
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            self::$body = $decoded;
        } elseif (!empty($_POST)) {
            self::$body = $_POST;
        } else {
            self::$body = [];
        }
        return self::$body;
    }

    /** A single field from the body, then the query string. */
    public static function input(string $key, $default = null)
    {
        $body = self::body();
        if (array_key_exists($key, $body)) {
            return $body[$key];
        }
        return $_GET[$key] ?? $default;
    }

    public static function query(string $key, $default = null)
    {
        return $_GET[$key] ?? $default;
    }

    public static function ip(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public static function userAgent(): string
    {
        return substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250);
    }

    public static function bearer(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/Bearer\s+(\S+)/i', $header, $match)) {
            return $match[1];
        }
        // Some shared hosts strip the Authorization header entirely.
        $token = self::input('token');
        return is_string($token) && $token !== '' ? $token : null;
    }

    /* ------------------------------------------------------------
       Response
       ------------------------------------------------------------ */

    public static function cors(): void
    {
        $allowed = Config::get()['cors']['origins'];
        $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';

        if (in_array('*', $allowed, true)) {
            header('Access-Control-Allow-Origin: *');
        } elseif ($origin !== '' && in_array($origin, $allowed, true)) {
            header("Access-Control-Allow-Origin: $origin");
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin');
        }
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Access-Control-Max-Age: 86400');

        if (self::method() === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }

    public static function json($data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
        exit;
    }

    public static function ok($data = [], int $status = 200): never
    {
        self::json(is_array($data) ? ['ok' => true] + $data : ['ok' => true, 'data' => $data], $status);
    }

    public static function fail(string $message, int $status = 400, array $extra = []): never
    {
        self::json(['ok' => false, 'error' => $message] + $extra, $status);
    }

    /* ------------------------------------------------------------
       Validation
       ------------------------------------------------------------ */

    /**
     * Checks a set of fields against simple rules and fails with every
     * problem at once, rather than making the caller fix them one at a
     * time. Returns the cleaned values.
     *
     * Rules: required, string, int, email, min:n, max:n, in:a|b, url
     */
    public static function validate(array $rules): array
    {
        $clean  = [];
        $errors = [];

        foreach ($rules as $field => $ruleString) {
            $value = self::input($field);
            $parts = explode('|', $ruleString);
            $required = in_array('required', $parts, true);

            if ($value === null || $value === '') {
                if ($required) {
                    $errors[$field] = 'This field is required.';
                }
                $clean[$field] = null;
                continue;
            }

            foreach ($parts as $rule) {
                [$name, $argument] = array_pad(explode(':', $rule, 2), 2, null);
                switch ($name) {
                    case 'string':
                        $value = trim((string) $value);
                        break;
                    case 'int':
                        if (!is_numeric($value)) {
                            $errors[$field] = 'Must be a number.';
                        }
                        $value = (int) $value;
                        break;
                    case 'float':
                        if (!is_numeric($value)) {
                            $errors[$field] = 'Must be a number.';
                        }
                        $value = (float) $value;
                        break;
                    case 'bool':
                        $value = filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
                        break;
                    case 'email':
                        if (!filter_var((string) $value, FILTER_VALIDATE_EMAIL)) {
                            $errors[$field] = 'That does not look like an email address.';
                        }
                        break;
                    case 'url':
                        if (!filter_var((string) $value, FILTER_VALIDATE_URL) || !str_starts_with((string) $value, 'https://')) {
                            $errors[$field] = 'Must be an https:// address.';
                        }
                        break;
                    case 'min':
                        if (is_string($value) ? bo_strlen($value) < (int) $argument : $value < (int) $argument) {
                            $errors[$field] = "Must be at least $argument" . (is_string($value) ? ' characters.' : '.');
                        }
                        break;
                    case 'max':
                        if (is_string($value) ? bo_strlen($value) > (int) $argument : $value > (int) $argument) {
                            $errors[$field] = "Must be no more than $argument" . (is_string($value) ? ' characters.' : '.');
                        }
                        break;
                    case 'in':
                        if (!in_array((string) $value, explode(',', (string) $argument), true)) {
                            $errors[$field] = "Must be one of: " . str_replace(',', ', ', (string) $argument);
                        }
                        break;
                    case 'username':
                        if (!preg_match("/^[\w .'-]{3,40}$/u", (string) $value)) {
                            $errors[$field] = 'Letters, numbers, spaces, hyphens and apostrophes only, 3 to 40 characters.';
                        }
                        break;
                }
            }
            $clean[$field] = $value;
        }

        if ($errors) {
            self::fail('Please correct the fields listed.', 422, ['fields' => $errors]);
        }
        return $clean;
    }

    /* ------------------------------------------------------------
       Rate limiting — crude, in-database, and enough to stop a script
       ------------------------------------------------------------ */

    public static function rateLimit(string $bucket, ?int $perMinute = null): void
    {
        $perMinute ??= Config::get()['rate']['per_minute'];
        $key = 'rate:' . $bucket . ':' . self::ip();

        try {
            $row = Database::one('SELECT body, expires_at FROM feed_cache WHERE cache_key = ?', [$key]);
            $now = time();
            if ($row && strtotime((string) $row['expires_at']) > $now) {
                $count = (int) $row['body'] + 1;
                if ($count > $perMinute) {
                    self::fail('Too many requests. Slow down.', 429);
                }
                Database::run('UPDATE feed_cache SET body = ? WHERE cache_key = ?', [(string) $count, $key]);
            } else {
                Database::run(
                    'REPLACE INTO feed_cache (cache_key, body, expires_at) VALUES (?, ?, ?)',
                    [$key, '1', date('Y-m-d H:i:s', $now + 60)]
                );
            }
        } catch (Throwable) {
            // Rate limiting must never be the reason a request fails.
        }
    }

    /** Records a write so there is an audit trail of who did what. */
    public static function audit(?int $userId, string $action, string $detail = ''): void
    {
        try {
            Database::run(
                'INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)',
                [$userId, $action, bo_substr($detail, 0, 500), self::ip()]
            );
        } catch (Throwable) {
            // An audit failure must not break the request it was recording.
        }
    }
}

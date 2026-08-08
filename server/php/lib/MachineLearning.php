<?php
declare(strict_types=1);

/**
 * MachineLearning.php — the PHP side of the Python ML service.
 *
 * The quantum and classical models live in Python, where NumPy makes
 * the linear algebra fast and where scikit-learn gives an honest
 * classical baseline to measure the quantum model against. PHP's job
 * is to call it, record what it decided, and degrade sensibly when the
 * service is not running.
 *
 * That last part matters: a coursework marker may well run the PHP and
 * MySQL half without starting a Python process, so every path here has
 * a fallback that still returns a usable answer.
 */
final class MachineLearning
{
    private static ?bool $up = null;

    /** Is the Python service reachable? Checked once per request. */
    public static function available(): bool
    {
        if (self::$up !== null) {
            return self::$up;
        }
        $response = self::call('GET', '/health', null, 2);
        self::$up = is_array($response) && ($response['ok'] ?? false);
        return self::$up;
    }

    /**
     * Classifies a request and records the verdict.
     *
     * `engine` may be 'quantum', 'classical' or 'both'. Recording every
     * decision is what makes the v_classifier_accuracy view meaningful:
     * the comparison between quantum and classical is then measured on
     * real traffic rather than asserted in a README.
     */
    public static function classify(string $text, string $engine = 'quantum', ?int $userId = null): array
    {
        $response = self::call('POST', '/classify', ['text' => $text, 'engine' => $engine], 12);

        if (!is_array($response) || !isset($response['intent'])) {
            $fallback = self::lexicalFallback($text);
            self::record($userId, $text, $fallback['intent'], $fallback['confidence'], 'lexical', true);
            return $fallback + [
                'engine'   => 'lexical',
                'degraded' => true,
                'note'     => 'The Python service is not running, so this came from the lexical baseline. '
                            . 'Start it with: python3 server/python/service.py',
            ];
        }

        self::record(
            $userId,
            $text,
            (string) $response['intent'],
            (float) ($response['confidence'] ?? 0),
            (string) ($response['engine'] ?? $engine),
            (bool) ($response['agree'] ?? true)
        );

        return $response + ['degraded' => false];
    }

    /**
     * Quantum against classical, as actually observed.
     * Reads the database view rather than recomputing anything.
     */
    public static function compare(): array
    {
        $observed = Database::all('SELECT * FROM v_classifier_accuracy');
        $benchmark = self::available() ? self::call('GET', '/benchmark', null, 60) : null;

        return [
            'observed'  => $observed,
            'benchmark' => $benchmark,
            'note'      => $benchmark
                ? 'The benchmark is a held-out comparison run by the Python service just now. '
                . 'The observed table is what has actually happened in this database.'
                : 'The Python service is not running, so only observed traffic is shown.',
        ];
    }

    private static function record(?int $userId, string $text, string $intent, float $confidence, string $engine, bool $agreed): void
    {
        try {
            Database::run(
                'INSERT INTO classifications (user_id, request, intent, confidence, engine, agreed)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$userId, bo_substr($text, 0, 500), $intent, round($confidence, 3), $engine, $agreed ? 1 : 0]
            );
        } catch (Throwable) {
            // Telemetry must never break the thing it is measuring.
        }
    }

    /* ------------------------------------------------------------
       Transport
       ------------------------------------------------------------ */

    private static function call(string $method, string $path, ?array $payload, int $timeout)
    {
        $url = Config::get()['python']['url'] . $path;

        if (!function_exists('curl_init')) {
            $context = stream_context_create(['http' => [
                'method'        => $method,
                'header'        => "Content-Type: application/json\r\n",
                'content'       => $payload ? json_encode($payload) : null,
                'timeout'       => $timeout,
                'ignore_errors' => true,
            ]]);
            $body = @file_get_contents($url, false, $context);
            return $body === false ? null : json_decode($body, true);
        }

        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        ]);
        if ($payload !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($payload));
        }
        $body   = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);

        if ($body === false || $status < 200 || $status >= 300) {
            return null;
        }
        return json_decode((string) $body, true);
    }

    /* ------------------------------------------------------------
       The no-Python fallback
       ------------------------------------------------------------ */

    /**
     * The same lexical baseline the browser uses while its circuits
     * train. Not clever, but it is the honest floor that the quantum
     * and classical models have to beat, and it keeps the endpoint
     * useful when nothing else is running.
     */
    private static function lexicalFallback(string $text): array
    {
        $lower = ' ' . strtolower(trim($text)) . ' ';
        $lexicon = [
            'calculate' => ['calculate', 'compute', 'how much', 'how many', 'how far', 'how fast', 'delta', 'budget', 'orbit', 'velocity', 'altitude', 'period', 'mass', 'power', 'gravity', 'weigh'],
            'lookup'    => ['who', 'what is', 'tell me about', 'when did', 'history', 'discovered', 'explain', 'describe'],
            'live'      => ['now', 'right now', 'today', 'tonight', 'current', 'latest', 'live', 'upcoming', 'where is', 'track', 'forecast'],
            'code'      => ['code', 'python', 'javascript', 'script', 'program', 'function', 'api', 'implement'],
            'reflect'   => ['why', 'meaning', 'feel', 'beautiful', 'alone', 'soul', 'love', 'afraid', 'hope', 'philosophy'],
        ];

        $scores = [];
        foreach ($lexicon as $intent => $words) {
            $hits = 0;
            foreach ($words as $word) {
                if (str_contains($lower, $word)) {
                    $hits++;
                }
            }
            $scores[$intent] = $hits;
        }
        $total = array_sum($scores);
        if ($total === 0) {
            return ['intent' => 'lookup', 'confidence' => 0.2, 'scores' => $scores];
        }

        arsort($scores);
        $best = array_key_first($scores);
        return [
            'intent'     => $best,
            'confidence' => round($scores[$best] / $total, 3),
            'scores'     => array_map(static fn (int $n): float => round($n / $total, 3), $scores),
        ];
    }
}

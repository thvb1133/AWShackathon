<?php
declare(strict_types=1);

/**
 * Feeds.php — third-party data, fetched once and shared.
 *
 * Two problems this solves that the browser could not.
 *
 * First, NASA's DEMO_KEY allows thirty requests an hour per address.
 * In the browser that budget was spent per visitor. Here one server
 * fetch is cached and served to everybody, so a class of thirty
 * students loading the page at once costs a single request.
 *
 * Second, JPL's Solar System Dynamics API sends no CORS header, so a
 * browser is forbidden to read its reply. PHP is not a browser and has
 * no such restriction, which means the two JPL panels that previously
 * had to explain themselves now simply work.
 */
final class Feeds
{
    /** source => [url, cache seconds] */
    private static function sources(): array
    {
        $key = Config::get()['nasa']['key'];
        return [
            'apod'      => ["https://api.nasa.gov/planetary/apod?api_key=$key&thumbs=true", 6 * 3600],
            'neo'       => [
                'https://api.nasa.gov/neo/rest/v1/feed?start_date=' . date('Y-m-d')
                . '&end_date=' . date('Y-m-d', strtotime('+2 days')) . "&api_key=$key",
                3 * 3600,
            ],
            'donki'     => [
                'https://api.nasa.gov/DONKI/notifications?startDate=' . date('Y-m-d', strtotime('-7 days'))
                . '&endDate=' . date('Y-m-d') . "&type=all&api_key=$key",
                2 * 3600,
            ],
            // No key, and no CORS either — which is exactly why it belongs here.
            'cad'       => ['https://ssd-api.jpl.nasa.gov/cad.api?dist-max=0.05&date-min=now&sort=date&limit=25', 6 * 3600],
            'fireball'  => ['https://ssd-api.jpl.nasa.gov/fireball.api?limit=20&sort=-date', 12 * 3600],
            'iss'       => ['https://api.wheretheiss.at/v1/satellites/25544', 20],
            'launches'  => ['https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&mode=list', 3600],
            'solarwind' => ['https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json', 1800],
            'kindex'    => ['https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', 1800],
            'tle'       => ['https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', 2 * 3600],
        ];
    }

    public static function fetch(string $source): array
    {
        $sources = self::sources();
        if (!isset($sources[$source])) {
            Http::fail('Unknown feed. Known: ' . implode(', ', array_keys($sources)), 404);
        }
        [$url, $ttl] = $sources[$source];
        $key = "feed:$source";

        $cached = Database::one('SELECT body, fetched_at, expires_at FROM feed_cache WHERE cache_key = ?', [$key]);
        if ($cached && strtotime((string) $cached['expires_at']) > time()) {
            return [
                'source'     => $source,
                'origin'     => 'cache',
                'fetched_at' => $cached['fetched_at'],
                'data'       => self::decode((string) $cached['body']),
            ];
        }

        $body = self::request($url);

        if ($body === null) {
            // A stale answer beats no answer, and the caller is told which.
            if ($cached) {
                return [
                    'source'     => $source,
                    'origin'     => 'stale-cache',
                    'fetched_at' => $cached['fetched_at'],
                    'data'       => self::decode((string) $cached['body']),
                ];
            }
            Http::fail("Could not reach the $source feed and nothing is cached.", 502);
        }

        Database::run(
            'REPLACE INTO feed_cache (cache_key, body, fetched_at, expires_at) VALUES (?, ?, ?, ?)',
            [$key, $body, date('Y-m-d H:i:s'), date('Y-m-d H:i:s', time() + $ttl)]
        );

        return [
            'source'     => $source,
            'origin'     => 'live',
            'fetched_at' => date('Y-m-d H:i:s'),
            'data'       => self::decode($body),
        ];
    }

    /** cURL when it is available, streams otherwise. Never blocks for long. */
    private static function request(string $url): ?string
    {
        if (function_exists('curl_init')) {
            $curl = curl_init($url);
            curl_setopt_array($curl, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 15,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 3,
                CURLOPT_USERAGENT      => 'BeyondOrbit/1.0 (+educational project)',
            ]);
            $body   = curl_exec($curl);
            $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
            curl_close($curl);
            return ($body !== false && $status >= 200 && $status < 300) ? (string) $body : null;
        }

        $context = stream_context_create(['http' => [
            'timeout'    => 15,
            'user_agent' => 'BeyondOrbit/1.0 (+educational project)',
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($url, false, $context);
        return $body === false ? null : $body;
    }

    /** TLE data is plain text; everything else is JSON. */
    private static function decode(string $body)
    {
        $decoded = json_decode($body, true);
        return json_last_error() === JSON_ERROR_NONE ? $decoded : $body;
    }

    /** Used by the health endpoint and the cron script. */
    public static function warmAll(): array
    {
        $results = [];
        foreach (array_keys(self::sources()) as $source) {
            try {
                $result = self::fetch($source);
                $results[$source] = $result['origin'];
            } catch (Throwable $error) {
                $results[$source] = 'failed: ' . $error->getMessage();
            }
        }
        return $results;
    }
}

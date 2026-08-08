<?php
declare(strict_types=1);

/**
 * router.php — development router for PHP's built-in web server.
 *
 * Run from the repository root:
 *
 *   php -S 127.0.0.1:8081 server/router.php
 *
 * Static files keep their normal relative URLs. Requests beginning /api
 * are sent to the single PHP front controller. This is development
 * plumbing only; Apache / nginx deployments should point /api at
 * server/php/api/index.php instead.
 */

$uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$root = dirname(__DIR__);

if (str_starts_with($uri, '/api')) {
    $_GET['route'] = trim(substr($uri, strlen('/api')), '/');
    require __DIR__ . '/php/api/index.php';
    return true;
}

$path = realpath($root . $uri);
if ($path !== false && str_starts_with($path, $root) && is_file($path)) {
    return false;
}

// Browser-friendly fallback for a static single-page deployment.
if ($uri === '/' || $uri === '') {
    require $root . '/index.html';
    return true;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "Not found: $uri";

<?php
declare(strict_types=1);

/**
 * index.php — the whole REST API, in one front controller.
 *
 * Every request enters here. Apache and PHP's built-in server both
 * route to this file, so the endpoint list below is the complete and
 * only surface the browser can reach.
 *
 *   POST   /api/register                 create a cadet
 *   POST   /api/login                    exchange credentials for a token
 *   POST   /api/logout                   destroy the token
 *   GET    /api/me                       the logged-in profile and progress
 *
 *   POST   /api/progress/level           record a completed level (idempotent)
 *   POST   /api/progress/planet          record a world visited in 3D
 *   GET    /api/progress                 everything about the current cadet
 *   POST   /api/progress/sync            push a whole localStorage blob up
 *
 *   POST   /api/quiz                     record an attempt with its answers
 *   GET    /api/quiz/stats               per-question difficulty, all cadets
 *   POST   /api/reflection               save the written reflection
 *
 *   GET    /api/leaderboard              the ranking, computed by SQL
 *
 *   GET    /api/memory                   the assistant's memory of you
 *   POST   /api/memory                   remember something
 *   DELETE /api/memory?id=n              forget it, permanently
 *
 *   GET    /api/jobs                     scheduled automations
 *   POST   /api/jobs                     schedule one
 *   DELETE /api/jobs?id=n                remove one
 *   GET    /api/inbox                    drafts awaiting approval
 *   POST   /api/inbox                    file a draft
 *   POST   /api/inbox/decide             approve or reject
 *
 *   POST   /api/classify                 quantum ML routing, via Python
 *   GET    /api/ml/compare               quantum against classical, measured
 *   GET    /api/feed?source=apod         server-side cached third-party feed
 *
 *   GET    /api/health                   is everything up
 *   POST   /api/install                  create the schema
 */

require __DIR__ . '/../lib/Config.php';
require __DIR__ . '/../lib/Database.php';
require __DIR__ . '/../lib/Http.php';
require __DIR__ . '/../lib/Auth.php';
require __DIR__ . '/../lib/Progress.php';
require __DIR__ . '/../lib/Memory.php';
require __DIR__ . '/../lib/Feeds.php';
require __DIR__ . '/../lib/MachineLearning.php';

Http::cors();

set_exception_handler(static function (Throwable $error): void {
    $debug = Config::get()['debug'];
    error_log('[beyond-orbit] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
    Http::fail(
        $debug ? $error->getMessage() : 'Something failed on the server.',
        500,
        $debug ? ['where' => $error->getFile() . ':' . $error->getLine()] : []
    );
});

/* The path after /api, however the server was configured to get here. */
$path = (string) (
    $_GET['route']
    ?? trim(preg_replace('#^.*?/api/?#', '', parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: ''), '/')
);
$route  = $path === '' ? 'health' : $path;
$method = Http::method();

/* ------------------------------------------------------------------
   Routes that must work before the schema exists
   ------------------------------------------------------------------ */

if ($route === 'health') {
    $ready = Database::ready();
    Http::ok([
        'service'  => 'Beyond Orbit API',
        'php'      => PHP_VERSION,
        'driver'   => Database::driver(),
        'schema'   => $ready ? 'installed' : 'not installed',
        'users'    => $ready ? (int) Database::value('SELECT COUNT(*) FROM users') : 0,
        'python'   => MachineLearning::available(),
        'time'     => date('c'),
    ]);
}

if ($route === 'install' && $method === 'POST') {
    $result = Database::install();
    Http::audit(null, 'install', $result['driver']);
    Http::ok($result);
}

if (!Database::ready()) {
    Http::fail('The database schema is not installed. POST to /api/install first.', 503);
}

/* ------------------------------------------------------------------
   Authentication
   ------------------------------------------------------------------ */

if ($route === 'register' && $method === 'POST') {
    Http::rateLimit('register', 10);
    $input = Http::validate([
        'username' => 'required|string|username',
        'email'    => 'required|string|email|max:190',
        'password' => 'required|string|min:6|max:200',
        'phone'    => 'string|max:30',
        'address'  => 'string|max:255',
        'avatar'   => 'string|max:16',
    ]);
    Http::ok(Auth::register($input), 201);
}

if ($route === 'login' && $method === 'POST') {
    Http::rateLimit('login', 20);
    $input = Http::validate([
        'username' => 'required|string|max:190',
        'password' => 'required|string|max:200',
    ]);
    Http::ok(Auth::login($input['username'], $input['password']));
}

if ($route === 'logout' && $method === 'POST') {
    Auth::logout();
    Http::ok(['message' => 'Signed out.']);
}

if ($route === 'me' && $method === 'GET') {
    $user = Auth::require();
    Http::ok([
        'user'     => Auth::profile((int) $user['id']),
        'progress' => Progress::summary((int) $user['id']),
    ]);
}

/* ------------------------------------------------------------------
   Progress
   ------------------------------------------------------------------ */

if ($route === 'progress' && $method === 'GET') {
    $user = Auth::require();
    Http::ok(['progress' => Progress::summary((int) $user['id'])]);
}

if ($route === 'progress/level' && $method === 'POST') {
    $user  = Auth::require();
    $input = Http::validate([
        'level_id'  => 'required|string|max:40',
        'course_id' => 'required|string|in:thorn,penguin',
        'xp'        => 'int|min:0|max:100',
    ]);
    Http::ok(Progress::completeLevel(
        (int) $user['id'],
        $input['level_id'],
        $input['course_id'],
        (int) ($input['xp'] ?? 10)
    ));
}

if ($route === 'progress/planet' && $method === 'POST') {
    $user  = Auth::require();
    $input = Http::validate(['body_id' => 'required|string|max:40']);
    Http::ok(Progress::visitPlanet((int) $user['id'], $input['body_id']));
}

if ($route === 'progress/sync' && $method === 'POST') {
    $user = Auth::require();
    Http::ok(Progress::sync((int) $user['id'], (array) Http::input('progress', [])));
}

/* ------------------------------------------------------------------
   Quiz and reflection
   ------------------------------------------------------------------ */

if ($route === 'quiz' && $method === 'POST') {
    $user  = Auth::require();
    $input = Http::validate([
        'score' => 'required|int|min:0|max:100',
        'total' => 'required|int|min:1|max:100',
        'topic' => 'string|max:40',
    ]);
    Http::ok(Progress::recordQuiz(
        (int) $user['id'],
        (int) $input['score'],
        (int) $input['total'],
        (string) ($input['topic'] ?? 'all'),
        (array) Http::input('answers', [])
    ));
}

if ($route === 'quiz/stats' && $method === 'GET') {
    Http::ok(['questions' => Progress::quizStats()]);
}

if ($route === 'reflection' && $method === 'POST') {
    $user  = Auth::require();
    $input = Http::validate(['body' => 'required|string|min:20|max:8000']);
    Http::ok(Progress::saveReflection((int) $user['id'], $input['body']));
}

/* ------------------------------------------------------------------
   Leaderboard
   ------------------------------------------------------------------ */

if ($route === 'leaderboard' && $method === 'GET') {
    $limit = max(1, min(100, (int) Http::query('limit', 25)));
    Http::ok(['leaderboard' => Progress::leaderboard($limit)]);
}

/* ------------------------------------------------------------------
   Memory
   ------------------------------------------------------------------ */

if ($route === 'memory') {
    $user = Auth::require();
    if ($method === 'GET') {
        Http::ok(['memories' => Memory::all((int) $user['id'])]);
    }
    if ($method === 'POST') {
        $input = Http::validate([
            'body'       => 'required|string|min:3|max:500',
            'kind'       => 'string|max:20',
            'confidence' => 'float|min:0|max:1',
            'source'     => 'string|max:80',
        ]);
        Http::ok(Memory::remember((int) $user['id'], $input));
    }
    if ($method === 'DELETE') {
        $id = (int) Http::query('id', 0);
        Http::ok(['forgotten' => Memory::forget((int) $user['id'], $id)]);
    }
}

/* ------------------------------------------------------------------
   Automations and inbox
   ------------------------------------------------------------------ */

if ($route === 'jobs') {
    $user = Auth::require();
    if ($method === 'GET') {
        Http::ok(['jobs' => Database::all('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC', [$user['id']])]);
    }
    if ($method === 'POST') {
        $input = Http::validate([
            'name'        => 'required|string|max:120',
            'crew'        => 'required|string|max:40',
            'brief'       => 'required|string|max:500',
            'interval_id' => 'string|max:10',
            'webhook_url' => 'string|max:500',
        ]);
        $id = Database::insert(
            'INSERT INTO jobs (user_id, name, crew, brief, interval_id, webhook_url) VALUES (?, ?, ?, ?, ?, ?)',
            [$user['id'], $input['name'], $input['crew'], $input['brief'], $input['interval_id'] ?? '1h', $input['webhook_url'] ?? null]
        );
        Http::audit((int) $user['id'], 'job_created', $input['name']);
        Http::ok(['id' => $id], 201);
    }
    if ($method === 'DELETE') {
        $id = (int) Http::query('id', 0);
        Http::ok(['removed' => Database::affected('DELETE FROM jobs WHERE id = ? AND user_id = ?', [$id, $user['id']])]);
    }
}

if ($route === 'inbox') {
    $user = Auth::require();
    if ($method === 'GET') {
        Http::ok(['items' => Database::all(
            'SELECT id, job_id, title, summary, confidence, status, note, created_at, decided_at
             FROM inbox_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
            [$user['id']]
        )]);
    }
    if ($method === 'POST') {
        $input = Http::validate([
            'title'      => 'required|string|max:200',
            'summary'    => 'required|string|max:8000',
            'confidence' => 'float|min:0|max:1',
            'job_id'     => 'int',
        ]);
        $id = Database::insert(
            'INSERT INTO inbox_items (user_id, job_id, title, summary, payload, confidence) VALUES (?, ?, ?, ?, ?, ?)',
            [
                $user['id'],
                $input['job_id'] ?: null,
                $input['title'],
                $input['summary'],
                json_encode(Http::input('payload', []), JSON_UNESCAPED_UNICODE),
                $input['confidence'] ?? 0.5,
            ]
        );
        Http::ok(['id' => $id], 201);
    }
}

if ($route === 'inbox/decide' && $method === 'POST') {
    $user  = Auth::require();
    $input = Http::validate([
        'id'       => 'required|int',
        'decision' => 'required|string|in:approved,rejected',
        'note'     => 'string|max:500',
    ]);
    $changed = Database::affected(
        'UPDATE inbox_items SET status = ?, note = ?, decided_at = ? WHERE id = ? AND user_id = ? AND status = ?',
        [$input['decision'], $input['note'] ?? null, date('Y-m-d H:i:s'), $input['id'], $user['id'], 'pending']
    );
    Http::audit((int) $user['id'], 'inbox_' . $input['decision'], (string) $input['id']);
    Http::ok(['updated' => $changed]);
}

/* ------------------------------------------------------------------
   Machine learning
   ------------------------------------------------------------------ */

if ($route === 'classify' && $method === 'POST') {
    Http::rateLimit('classify', 200);
    $input  = Http::validate(['text' => 'required|string|min:2|max:500']);
    $engine = (string) (Http::input('engine', 'quantum'));
    $user   = Auth::current();
    Http::ok(MachineLearning::classify($input['text'], $engine, $user ? (int) $user['id'] : null));
}

if ($route === 'ml/compare' && $method === 'GET') {
    Http::ok(MachineLearning::compare());
}

if ($route === 'ml/correct' && $method === 'POST') {
    $input = Http::validate([
        'id'     => 'required|int',
        'intent' => 'required|string|max:20',
    ]);
    Http::ok(['updated' => Database::affected(
        'UPDATE classifications SET corrected_to = ? WHERE id = ?',
        [$input['intent'], $input['id']]
    )]);
}

/* ------------------------------------------------------------------
   Server-side feed cache
   ------------------------------------------------------------------ */

if ($route === 'feed' && $method === 'GET') {
    Http::rateLimit('feed', 120);
    Http::ok(Feeds::fetch((string) Http::query('source', 'apod')));
}

Http::fail("No such endpoint: /$route", 404, ['method' => $method]);

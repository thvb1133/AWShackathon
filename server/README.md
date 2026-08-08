# Beyond Orbit server

The website runs as a useful static application on GitHub Pages. This folder is the optional **real server** upgrade:

- PHP 8.2+ REST API
- SQLite by default, MySQL/MariaDB when configured
- bcrypt passwords and hashed bearer-session tokens
- server-side progress, leaderboards, memory, jobs and approval inbox
- server-side feed cache, including JPL feeds that browsers cannot read because of CORS
- Python + NumPy quantum-kernel classifier, with a classical baseline measured beside it

## Fast local run — SQLite, no setup

From the repository root, use two terminals:

```bash
# Terminal 1 — Python ML service
python3 server/python/service.py

# Terminal 2 — PHP serves both the website and /api
php -S 127.0.0.1:8081 server/router.php
```

Then visit <http://127.0.0.1:8081>. On the first visit the static pages still work normally. Install the database once:

```bash
curl -X POST http://127.0.0.1:8081/api/install
```

Or open `http://127.0.0.1:8081/api/health` to check it:

```json
{
  "ok": true,
  "service": "Beyond Orbit API",
  "driver": "sqlite",
  "schema": "installed",
  "python": true
}
```

The SQLite file is created under `server/data/`; it is deliberately ignored by Git.

## MySQL/MariaDB

```bash
cp server/.env.example server/.env
```

Set:

```dotenv
BO_DB_DRIVER=mysql
BO_DB_HOST=127.0.0.1
BO_DB_NAME=beyond_orbit
BO_DB_USER=beyond_orbit
BO_DB_PASS=a-long-unique-password
```

Create the database and a least-privilege account:

```sql
CREATE DATABASE beyond_orbit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'beyond_orbit'@'localhost' IDENTIFIED BY 'a-long-unique-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON beyond_orbit.* TO 'beyond_orbit'@'localhost';
FLUSH PRIVILEGES;
```

Then run the same install request:

```bash
curl -X POST http://127.0.0.1:8081/api/install
```

`sql/schema.sql` is the MySQL/MariaDB schema. `sql/schema.sqlite.sql` is intentionally separate: SQLite is not MySQL
with words replaced, and keeping an explicit schema prevents partial installation.

## PHP deployment

Configure your web server so:

```text
/api/*  -> server/php/api/index.php
/*      -> repository static files
```

For Apache, point an alias or a virtual host at the repository root and rewrite `/api/*` to the front controller.
For nginx, use a `location ^~ /api/` block with `fastcgi_pass` to PHP-FPM and set `SCRIPT_FILENAME` to
`server/php/api/index.php`.

Set `BO_CORS_ORIGINS` to the exact HTTPS domain(s) that will call the API. `*` is tolerable for this coursework demo,
but wrong for a production account service.

## Python ML service

The Python service uses only the standard library and NumPy; NumPy is the only dependency.

```bash
python3 server/python/service.py
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/classify \
  -H 'Content-Type: application/json' \
  -d '{"text":"where is the ISS right now","engine":"both"}'
curl http://127.0.0.1:8000/benchmark
```

It does not claim a quantum advantage. It simulates a five-qubit state vector, encodes the request through RY gates and
a CNOT ring, and classifies via the actual kernel `|<ψ(x)|ψ(x')>|²`. It reports the result beside a classical
cosine-centroid baseline. The PHP endpoint records what actually happened in the database, so `/api/ml/compare` can
show observed traffic rather than only a benchmark.

## Security model

- Registration uses `password_hash()` bcrypt; the old browser-only hash is not used by this service.
- Sessions are random 256-bit bearer tokens; only their SHA-256 hashes are stored in the database.
- Every SQL query is prepared with bound parameters.
- Database foreign keys cascade on user deletion.
- API writes are audited.
- The server caches public feeds and can read JPL's CORS-blocked API server-side.
- Do not put production secrets in `.env.example`, commit `server/.env`, or deploy `BO_DEBUG=1`.

## API surface

```text
POST   /api/install
GET    /api/health
POST   /api/register
POST   /api/login
POST   /api/logout
GET    /api/me

GET    /api/progress
POST   /api/progress/level
POST   /api/progress/planet
POST   /api/progress/sync
POST   /api/quiz
GET    /api/quiz/stats
POST   /api/reflection
GET    /api/leaderboard

GET    /api/memory
POST   /api/memory
DELETE /api/memory?id=<id>
GET    /api/jobs
POST   /api/jobs
DELETE /api/jobs?id=<id>
GET    /api/inbox
POST   /api/inbox
POST   /api/inbox/decide

POST   /api/classify
GET    /api/ml/compare
GET    /api/feed?source=apod
```

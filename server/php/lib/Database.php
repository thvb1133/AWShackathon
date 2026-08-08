<?php
declare(strict_types=1);

/**
 * Database.php — one PDO connection, two dialects.
 *
 * Beyond Orbit has to run in two very different places: a marked
 * coursework submission on a university LAMP box with MySQL, and a
 * laptop where somebody just wants to open it. So the same schema is
 * supported on MySQL/MariaDB and on SQLite, and the handful of places
 * the dialects genuinely differ are translated here rather than by
 * maintaining two drifting copies of the SQL.
 *
 * Everything else in the application uses prepared statements only.
 * There is no string concatenation of user input into SQL anywhere in
 * this codebase, which is the single most important thing to be able
 * to say about a database layer.
 */
final class Database
{
    private static ?PDO $pdo = null;
    private static string $driver = 'mysql';

    /** Opens (or reuses) the connection described by config.php. */
    public static function connect(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $config = Config::get();
        self::$driver = $config['db']['driver'];

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Real prepared statements, not client-side interpolation.
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        if (self::$driver === 'sqlite') {
            $path = $config['db']['path'];
            $dir  = dirname($path);
            if (!is_dir($dir)) {
                mkdir($dir, 0775, true);
            }
            self::$pdo = new PDO('sqlite:' . $path, null, null, $options);
            // Foreign keys are off by default in SQLite, which would quietly
            // defeat every ON DELETE CASCADE in the schema.
            self::$pdo->exec('PRAGMA foreign_keys = ON');
            self::$pdo->exec('PRAGMA journal_mode = WAL');
        } else {
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                $config['db']['host'],
                $config['db']['port'],
                $config['db']['name']
            );
            self::$pdo = new PDO($dsn, $config['db']['user'], $config['db']['pass'], $options);
        }

        return self::$pdo;
    }

    public static function driver(): string
    {
        self::connect();
        return self::$driver;
    }

    public static function isSqlite(): bool
    {
        return self::driver() === 'sqlite';
    }

    /* ------------------------------------------------------------
       Query helpers. Every one of them takes bound parameters.
       ------------------------------------------------------------ */

    public static function run(string $sql, array $params = []): PDOStatement
    {
        $statement = self::connect()->prepare($sql);
        $statement->execute($params);
        return $statement;
    }

    /** @return array<string,mixed>|null */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<int,array<string,mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    public static function value(string $sql, array $params = [])
    {
        $value = self::run($sql, $params)->fetchColumn();
        return $value === false ? null : $value;
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::run($sql, $params);
        return (int) self::connect()->lastInsertId();
    }

    public static function affected(string $sql, array $params = []): int
    {
        return self::run($sql, $params)->rowCount();
    }

    /** Runs a closure inside a transaction, rolling back on any throw. */
    public static function transaction(callable $work)
    {
        $pdo = self::connect();
        $pdo->beginTransaction();
        try {
            $result = $work($pdo);
            $pdo->commit();
            return $result;
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }

    /* ------------------------------------------------------------
       Schema installation
       ------------------------------------------------------------ */

    /**
     * Creates the schema if it is not already there.
     *
     * The MySQL file is the canonical one; for SQLite it is translated
     * on the way in. The translation is small and deliberately dumb —
     * anything cleverer would be a migration tool, and this project
     * does not need one.
     */
    public static function install(?string $sqlFile = null): array
    {
        /* SQLite is not "MySQL with words replaced". Its views, index
           declarations and auto-increment semantics are sufficiently
           different that a regex translation left a half-installed
           database. Use the deliberately maintained companion schema
           instead. */
        $sqlFile ??= dirname(__DIR__, 2) . '/sql/' . (self::isSqlite() ? 'schema.sqlite.sql' : 'schema.sql');
        if (!is_readable($sqlFile)) {
            throw new RuntimeException("Cannot read schema file: $sqlFile");
        }
        $sql = file_get_contents($sqlFile);

        $pdo       = self::connect();
        $statements = self::splitStatements($sql);
        $applied    = 0;
        $skipped    = [];

        foreach ($statements as $statement) {
            try {
                $pdo->exec($statement);
                $applied++;
            } catch (PDOException $error) {
                // "already exists" is the expected outcome of re-running install.
                if (str_contains(strtolower($error->getMessage()), 'already exists')) {
                    continue;
                }
                $skipped[] = substr($statement, 0, 60) . ' — ' . $error->getMessage();
            }
        }

        return ['applied' => $applied, 'skipped' => $skipped, 'driver' => self::driver()];
    }

    /** Translates the MySQL schema into something SQLite accepts. */
    private static function toSqlite(string $sql): string
    {
        $replacements = [
            '/ENGINE=InnoDB[^;]*/i'                  => '',
            '/\bINT UNSIGNED NOT NULL AUTO_INCREMENT\b/i'    => 'INTEGER',
            '/\bBIGINT UNSIGNED NOT NULL AUTO_INCREMENT\b/i' => 'INTEGER',
            '/\bAUTO_INCREMENT\b/i'                  => '',
            '/\bUNSIGNED\b/i'                        => '',
            '/\bTINYINT\(1\)/i'                      => 'INTEGER',
            '/\bSMALLINT\b/i'                        => 'INTEGER',
            '/\bBIGINT\b/i'                          => 'INTEGER',
            '/\bLONGTEXT\b/i'                        => 'TEXT',
            '/\bDATETIME\b/i'                        => 'TEXT',
            '/\bDECIMAL\(\d+,\d+\)/i'                => 'REAL',
            '/\bENUM\([^)]*\)/i'                     => 'TEXT',
            '/ ON UPDATE CURRENT_TIMESTAMP/i'        => '',
            '/^SET NAMES.*$/mi'                      => '',
            // SQLite indexes cannot be declared inside CREATE TABLE.
            '/^\s*KEY\s+\w+\s*\([^)]*\),?\s*$/mi'    => '',
            '/,(\s*)\)/'                             => '$1)',
        ];
        $sql = preg_replace(array_keys($replacements), array_values($replacements), $sql);

        // PRIMARY KEY (id) plus INTEGER gives SQLite its rowid alias, but only
        // when written inline, so fold the trailing declaration into the column.
        $sql = preg_replace('/\bid\s+INTEGER,/i', 'id INTEGER PRIMARY KEY AUTOINCREMENT,', $sql);
        $sql = preg_replace('/^\s*PRIMARY KEY \(id\),?\s*$/mi', '', $sql);

        return $sql;
    }

    /** @return array<int,string> */
    private static function splitStatements(string $sql): array
    {
        // Strip comment lines first so a semicolon inside one cannot split a statement.
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        return array_values(array_filter(
            array_map('trim', explode(';', $sql)),
            static fn (string $s): bool => $s !== ''
        ));
    }

    /** True when the schema has been installed. */
    public static function ready(): bool
    {
        try {
            self::value('SELECT COUNT(*) FROM users');
            return true;
        } catch (Throwable) {
            return false;
        }
    }

    /** Used by the tests to start from a known state. */
    public static function reset(): void
    {
        $tables = [
            'audit_log', 'feed_cache', 'classifications', 'inbox_items', 'jobs',
            'memories', 'reflections', 'quiz_answers', 'quiz_attempts',
            'badges', 'planet_visits', 'level_completions', 'sessions', 'users',
        ];
        $pdo = self::connect();
        if (self::isSqlite()) {
            $pdo->exec('PRAGMA foreign_keys = OFF');
        } else {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        }
        foreach ($tables as $table) {
            try {
                $pdo->exec("DELETE FROM $table");
            } catch (Throwable) {
                // A table that is not there yet does not need emptying.
            }
        }
        if (self::isSqlite()) {
            $pdo->exec('PRAGMA foreign_keys = ON');
        } else {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        }
    }
}

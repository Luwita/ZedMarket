import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Work to do only once a transaction has been saved (e.g. sending an email), so nothing goes out if it rolls back.
function commitHooks() {
  const hooks = [];
  return [(fn) => hooks.push(fn), () => hooks.forEach((fn) => fn())];
}

// One small interface over two drivers:
//   DATABASE_URL=postgres://...  -> a real Postgres server (production)
//   otherwise                    -> PGlite, Postgres running in-process, stored in PGLITE_DIR (development)
// Both speak the same SQL, so queries and migrations are identical.
// A connection string as pasted into a host's settings: without surrounding spaces or quotes, or a leading
// "DATABASE_URL=" copied along with it.
export function cleanDatabaseUrl(url) {
  return (url ?? '')
    .trim()
    .replace(/^[A-Z_]+=/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

export async function createDb({ url = process.env.DATABASE_URL, dataDir = process.env.PGLITE_DIR } = {}) {
  url = cleanDatabaseUrl(url);
  // A connection string that isn't one is a setup mistake: never fall back to the built-in database for it.
  if (url && !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error('DATABASE_URL must start with postgresql:// (check the value in your host settings)');
  }
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url });
    return {
      kind: 'postgres',
      query: async (text, params) => (await pool.query(text, params)).rows,
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        const [afterCommit, runAfterCommit] = commitHooks();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: async (text, params) => (await client.query(text, params)).rows, afterCommit });
          await client.query('COMMIT');
          runAfterCommit();
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  if (dataDir) await mkdir(path.dirname(dataDir), { recursive: true });
  const pglite = new PGlite(dataDir || 'memory://', { extensions: { pg_trgm } });
  return {
    kind: dataDir ? 'pglite' : 'pglite (in memory)',
    location: dataDir || null,
    query: async (text, params) => (await pglite.query(text, params)).rows,
    exec: (sql) => pglite.exec(sql),
    async tx(fn) {
      const [afterCommit, runAfterCommit] = commitHooks();
      const result = await pglite.transaction((t) =>
        fn({ query: async (text, params) => (await t.query(text, params)).rows, afterCommit }),
      );
      runAfterCommit();
      return result;
    },
    close: () => pglite.close(),
  };
}

// Applies pending SQL migrations in order and returns the names of the ones applied now.
export async function migrate(db) {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (t) => {
      for (const statement of sql
        .split(/;\s*$/m)
        .map((s) => s.trim())
        .filter(Boolean)) {
        await t.query(statement);
      }
      await t.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

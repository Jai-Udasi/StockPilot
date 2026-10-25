import fs from 'node:fs';
import Database from 'better-sqlite3';

const filename = process.env.DATABASE_PATH;
if (!filename || !fs.existsSync(filename) || fs.statSync(filename).size === 0) {
  throw new Error('Set DATABASE_PATH to an existing, non-empty SQLite database to verify it.');
}

const db = new Database(filename, { readonly: true, fileMustExist: true });
try {
  const integrity = db.pragma('integrity_check', { simple: true });
  const foreignKeyViolations = db.pragma('foreign_key_check');
  const hasMigrations = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get());
  if (integrity !== 'ok' || foreignKeyViolations.length > 0 || !hasMigrations) {
    throw new Error(`SQLite verification failed (integrity=${integrity}, foreignKeyViolations=${foreignKeyViolations.length}, migrations=${hasMigrations}).`);
  }
  const version = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  console.log(`SQLite verification passed (integrity=ok, foreignKeyViolations=0, migration=${version}).`);
} finally {
  db.close();
}

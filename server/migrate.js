import { createDatabase } from './database.js';

const filename = process.env.DATABASE_PATH;
if (!filename) {
  throw new Error('Set DATABASE_PATH to the persistent SQLite file before running database migrations.');
}

const db = createDatabase(filename, { allowCreate: true, seed: false });
try {
  const version = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  console.log(`SQLite schema is ready at migration ${version}.`);
} finally {
  db.close();
}

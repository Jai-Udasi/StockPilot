import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const source = process.env.DATABASE_PATH;
const destination = process.env.BACKUP_PATH;

if (!source || !destination) {
  throw new Error('Set DATABASE_PATH and BACKUP_PATH before creating a SQLite backup.');
}

const sourcePath = path.resolve(source);
const backupPath = path.resolve(destination);
if (sourcePath === backupPath) {
  throw new Error('BACKUP_PATH must be different from DATABASE_PATH.');
}
if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size === 0) {
  throw new Error(`Source SQLite database does not exist or is empty: ${sourcePath}`);
}
if (fs.existsSync(backupPath)) {
  throw new Error(`Backup destination already exists; choose a new BACKUP_PATH: ${backupPath}`);
}

fs.mkdirSync(path.dirname(backupPath), { recursive: true });
const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  await db.backup(backupPath);
  console.log(`SQLite backup created at ${backupPath}`);
} finally {
  db.close();
}

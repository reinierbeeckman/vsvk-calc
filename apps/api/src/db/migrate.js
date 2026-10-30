import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureMigrationsTable(client) {
  await client.query('create schema if not exists core');
  await client.query(`
    create table if not exists core.schema_migration (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function listSqlFiles(sqlDir) {
  const entries = await fs.readdir(sqlDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.match(/^\d+_.*\.sql$/))
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  const sqlDir = path.resolve(__dirname, '..', '..', 'sql');
  const files = await listSqlFiles(sqlDir);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    const applied = await client.query('select filename from core.schema_migration');
    const appliedSet = new Set(applied.rows.map((row) => row.filename));

    for (const filename of files) {
      if (appliedSet.has(filename)) {
        continue;
      }

      const sql = await fs.readFile(path.join(sqlDir, filename), 'utf8');
      process.stdout.write(`Applying ${filename}... `);
      await client.query(sql);
      await client.query('insert into core.schema_migration(filename) values ($1)', [filename]);
      process.stdout.write('OK\n');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

await main();

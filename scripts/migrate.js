/**
 * Plain Node.js migration runner.
 * Runs directly with `node scripts/migrate.js` without requiring ts-node or devDependencies.
 */
const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');

// Safely load dotenv if available or if .env exists
try {
  require('dotenv').config({ path: join(__dirname, '..', '.env') });
} catch (e) {
  // Ignore if dotenv is not installed in current environment
}

const { Client } = require('pg');

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main() {
  let connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL is not set. Please set DATABASE_URL in .env or environment');
    process.exit(1);
  }

  // Trim newlines/spaces and fallback @postgres: to @127.0.0.1: when running outside container
  connectionString = connectionString.trim();
  if (connectionString.includes('@postgres:')) {
    connectionString = connectionString.replace('@postgres:', '@127.0.0.1:');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('create schema if not exists app');
    await client.query(`
      create table if not exists app.migrations (
        name        text primary key,
        applied_at  timestamptz not null default now()
      )
    `);

    const applied = new Set(
      (
        await client.query('select name from app.migrations')
      ).rows.map((row) => row.name),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    let count = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('begin');

      try {
        await client.query(sql);
        await client.query('insert into app.migrations (name) values ($1)', [
          file,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`${file} failed: ${error.message}`);
      }

      console.log(`  apply ${file}`);
      count += 1;
    }

    console.log(
      count === 0
        ? 'Database already up to date.'
        : `Applied ${count} migration(s).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

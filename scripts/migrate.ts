/**
 * Applies every .sql file in ./migrations in filename order, exactly once.
 *
 * Deliberately tiny: the schema is small enough that a migration framework
 * would be more moving parts than it is worth, and plain SQL files stay
 * readable next to the Supabase stack they run against.
 *
 *   npm run migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Not `public.schema_migrations`: Supabase's own init script already owns a
    // table by that name, with an incompatible `applied_at integer` column.
    await client.query('create schema if not exists app');
    await client.query(`
      create table if not exists app.migrations (
        name        text primary key,
        applied_at  timestamptz not null default now()
      )
    `);

    const applied = new Set(
      (
        await client.query<{ name: string }>('select name from app.migrations')
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

      // Each migration is atomic: either the whole file lands, or nothing does.
      await client.query('begin');

      try {
        await client.query(sql);
        await client.query('insert into app.migrations (name) values ($1)', [
          file,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`${file} failed: ${(error as Error).message}`);
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

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

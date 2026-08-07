/**
 * Diagnoses which Postgres actually answers on the configured DATABASE_URL.
 *
 *   node scripts/check-db.js
 */
const { join } = require('node:path');
const { Client } = require('pg');

require('dotenv').config({ path: join(__dirname, '..', '.env'), quiet: true });

async function probe(label, connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });

  try {
    await client.connect();
    const { rows } = await client.query(
      'select version() as version, current_database() as db, inet_server_port() as port',
    );
    console.log(`${label}: OK`);
    console.log(`  ${rows[0].version.split(' on ')[0]}`);
    console.log(`  database=${rows[0].db} port=${rows[0].port}`);
  } catch (error) {
    console.log(`${label}: FAILED — ${error.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  await probe('DATABASE_URL', url);

  // Same credentials, but forced onto IPv4 in case localhost resolves to ::1
  // and something else is listening there.
  await probe('via 127.0.0.1', url.replace('@localhost:', '@127.0.0.1:'));
}

void main();

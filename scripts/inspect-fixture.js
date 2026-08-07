/**
 * Prints the markup around given class names in a fixture, for working out
 * selectors without opening a 90 KB HTML file.
 *
 *   node scripts/inspect-fixture.js collection_customise.html nameplate_now mapicon_now
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const [file, ...needles] = process.argv.slice(2);

if (!file || needles.length === 0) {
  console.error('usage: node scripts/inspect-fixture.js <fixture.html> <class...>');
  process.exit(1);
}

const html = readFileSync(
  join(__dirname, '..', 'test', 'fixtures', 'chunithm-net', file),
  'utf8',
);

for (const needle of needles) {
  const match = html.match(new RegExp(`.{0,80}${needle}.{0,260}`, 's'));

  console.log(`--- ${needle} ---`);
  console.log(match ? match[0].replace(/\s+/g, ' ') : 'NOT FOUND');
  console.log();
}

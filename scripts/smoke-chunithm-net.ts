/**
 * Manual smoke test against the live CHUNITHM-NET.
 *
 * Not part of `npm test` — it makes real requests to SEGA. Run it after
 * touching the session/auth code:
 *
 *   npx ts-node scripts/smoke-chunithm-net.ts            # expects an auth failure
 *   npx ts-node scripts/smoke-chunithm-net.ts <clal>     # expects a real profile
 */
import { ChunithmNetAuthError } from '../src/shared/chunithm-net/chunithm-net.errors';
import {
  ChunithmNetService,
  normalizeClal,
} from '../src/shared/chunithm-net/chunithm-net.service';

async function main(): Promise<void> {
  const service = new ChunithmNetService();
  const raw = process.argv[2];

  if (!raw) {
    const session = service.createSession({ clal: 'f'.repeat(64) });

    try {
      await session.getHomePage();
      console.error('FAIL: a bogus clal was accepted');
      process.exitCode = 1;
    } catch (error) {
      if (error instanceof ChunithmNetAuthError) {
        console.log('OK: bogus clal rejected —', error.message);
      } else {
        console.error('FAIL: unexpected error type', error);
        process.exitCode = 1;
      }
    }

    return;
  }

  const clal = normalizeClal(raw);

  if (!clal) {
    console.error('FAIL: that does not look like a clal cookie');
    process.exitCode = 1;
    return;
  }

  const session = service.createSession({ clal });
  const profile = await session.getProfile();

  console.log('OK: logged in as', profile.username);
  console.log('  rating   :', profile.rating);
  console.log('  level    :', profile.level);
  console.log('  overpower:', profile.overPower);
  console.log('  credits  :', profile.totalCredits);

  const recents = await session.getRecentScores();
  console.log(`OK: ${recents.length} recent plays, newest:`);
  console.log(
    `  ${recents[0]?.song.title} — ${recents[0]?.score} @ ${recents[0]?.achievedAt}`,
  );

  const [best30, new20] = await Promise.all([
    session.getBest30(),
    session.getNew20(),
  ]);
  console.log(`OK: best30=${best30.length} new20=${new20.length}`);
}

void main();

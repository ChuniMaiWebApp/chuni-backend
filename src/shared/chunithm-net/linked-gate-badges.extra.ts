import { LinkedGateStatus } from './linked-verse';

/**
 * Badges observed on live CHUNITHM-NET that the upstream table does not carry.
 *
 * chuni-penguin's table stops at the NEW gate, so SUN and LUMINOUS badges were
 * unrecognised. This file is hand-maintained and merged over the generated one
 * — keep them separate so regenerating from upstream cannot wipe these.
 *
 * To find more, run: npx ts-node scripts/dump-linked-verse-badges.ts
 * Only add an entry when the account's real status is known; guessing here
 * reintroduces exactly the bug this file exists to fix.
 */
export const EXTRA_LINKED_GATE_BADGES: Record<string, LinkedGateStatus> = {
  // Observed 2026-08-07 on an account that had cleared both gates.
  '0W4PTHG72IIN3OIG0GBR3SF8OPB87CPN': LinkedGateStatus.CLEAR, // sun
  '7Q0L2EVXCT9VNA4XNS3D8ELZ61QO21AV': LinkedGateStatus.CLEAR, // luminous
};

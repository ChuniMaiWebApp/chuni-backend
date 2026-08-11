import { Injectable } from '@nestjs/common';

import { LinkedGateStatus } from '../../shared/chunithm-net/linked-verse';
import { DatabaseService } from '../../shared/database/database.service';

/**
 * What each Linked GATE badge image means.
 *
 * CHUNITHM-NET serves the hexagons under opaque filenames with nothing in the
 * markup to say which state they show, so the mapping has to be established by
 * someone who can see both — the player looking at their own gate.
 *
 * Kept in the database rather than in source so that it can grow without a
 * deploy. SEGA adds a gate every version, and the alternative is that a new
 * badge reads as "unknown" until somebody edits a file and ships it.
 */
@Injectable()
export class LinkedGateBadgesRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Every badge whose meaning is known, as filename to status. */
  async findKnown(): Promise<Record<string, LinkedGateStatus>> {
    const rows = await this.db.query<{ filename: string; status: string }>(
      'select filename, status from app.linked_gate_badges where status is not null',
    );

    const known: Record<string, LinkedGateStatus> = {};

    for (const row of rows) {
      known[row.filename] = row.status as LinkedGateStatus;
    }

    return known;
  }

  /**
   * Notes badges that have no meaning recorded yet.
   *
   * Inserted with a null status: the row is a question, not an answer. Fill it
   * in from Studio once you can see what the hexagon actually says —
   *
   *     update app.linked_gate_badges
   *        set status = 'clear', labelled_at = now()
   *      where filename = '...';
   *
   * Never guesses. A wrong status here reports the wrong progress to every
   * player who has that badge, and does it silently.
   */
  async recordUnknown(
    entries: ReadonlyArray<{ filename: string; gate: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    for (const entry of entries) {
      await this.db.query(
        `insert into app.linked_gate_badges (filename, gate)
         values ($1, $2)
         on conflict (filename) do update
            set gate = coalesce(app.linked_gate_badges.gate, excluded.gate)`,
        [entry.filename, entry.gate],
      );
    }
  }
}

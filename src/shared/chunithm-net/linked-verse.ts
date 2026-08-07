/**
 * Linked VERSE, the collaboration mode where a player unlocks one GATE per
 * CHUNITHM version.
 *
 * The order matters: CHUNITHM-NET renders the gates as a bare row of images
 * with nothing identifying them, so the only way to tell which is which is
 * their position, and that follows the release order of the versions.
 */
export enum LinkedGate {
  ORIGIN = 'origin',
  AIR = 'air',
  STAR = 'star',
  AMAZON = 'amazon',
  CRYSTAL = 'crystal',
  PARADISE = 'paradise',
  NEW = 'new',
  SUN = 'sun',
  LUMINOUS = 'luminous',
  VERSE = 'verse',
}

export enum LinkedGateStatus {
  /** The gate has not appeared for this player yet. */
  NOT_FOUND = 'not_found',
  UNDER_ANALYSIS = 'under_analysis',
  /** Unlocked and ready to be linked. */
  LINKABLE = 'linkable',
  CLEAR = 'clear',
  /**
   * The badge image is one we have no entry for.
   *
   * Reporting this rather than falling back to NOT_FOUND matters: SEGA adds a
   * gate every version, and treating an unrecognised badge as "not found" told
   * players who had cleared SUN and LUMINOUS that they had not even found
   * them. An honest "unknown" is visibly wrong and gets fixed; a plausible
   * wrong answer does not.
   */
  UNKNOWN = 'unknown',
}

export { LINKED_GATE_BADGES } from './linked-gate-badges';
export { EXTRA_LINKED_GATE_BADGES } from './linked-gate-badges.extra';

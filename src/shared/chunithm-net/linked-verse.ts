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

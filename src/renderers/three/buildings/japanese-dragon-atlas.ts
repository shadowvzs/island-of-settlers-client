/**
 * Column strips (u ranges) of the Japanese dragon atlas, shared by its painter and its geometry
 * (owner references: resources/references/japanese-dragon-2026-10-13/dragon-6…8.png). The body
 * wraps u 0…0.7 round its circumference: overlapping green scales (dark edges, lighter centres),
 * then the golden-ochre belly plates; v runs along the body and repeats every SCALE_REPEAT units.
 */
export const DRAGON_ATLAS = {
  /** Back and flank scales (u 0…0.5) followed by the belly plates (0.5…0.7): one body wrap. */
  wrap: { u0: 0, u1: .7 },
  scales: { u0: 0, u1: .5 },
  belly: { u0: .5, u1: .7 },
  /** Orange flame (fins, elbow and tail flames): deep orange at v 0, yellow tongues at v 1. */
  flame: { u0: .7, u1: .76 },
  /** Brown antler horn: ridged along v, dark at the root, pale at the tip. */
  antler: { u0: .76, u1: .8 },
  /** Green crest frill: deep green at the root (u 0) to lighter green at the tip, a vein along v 0.5. */
  frill: { u0: .8, u1: .84 },
  /** Orange eyes, softly lit in the glow map. */
  amber: { u0: .84, u1: .87 },
  /** Ivory fangs, claws, brow spikes and beard, ridged along v and paler towards the tip. */
  ivory: { u0: .87, u1: .91 },
  /** Pearlescent, also lit in the glow map. */
  pearl: { u0: .91, u1: .93 },
  /** Red mouth: shaded gums, palate and tongue. */
  mouth: { u0: .93, u1: .96 },
  /** Near-black green: pupils, nostrils, whiskers. */
  dark: { u0: .96, u1: 1 }
} as const;

export type DragonStrip = keyof typeof DRAGON_ATLAS;

/** Centre u of a strip: solid parts sample there, away from the neighbouring strips. */
export const stripCentre = (strip: DragonStrip) => (DRAGON_ATLAS[strip].u0 + DRAGON_ATLAS[strip].u1) / 2;

/** Body length (recipe units) covered by one v repeat of the scale pattern. */
export const SCALE_REPEAT = .16;
/** Scale rows in one v repeat, and scales round the back strip. */
export const SCALE_ROWS = 10;
export const SCALES_AROUND = 9;
/** Belly plates in one v repeat. */
export const BELLY_PLATES = 6;

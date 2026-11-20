import { LOAD_CARRY_STRIDE, WALK_DURATION, WALK_GROUND_SPEED } from "@workers/worker-locomotion";

import { HANDCART } from "./logistics/handcart-rules";
import { WORKER_SCALE } from "./workers/worker-dimensions";

/** Ground covered by one walk cycle (left + right step) of an unloaded worker, in cells. */
const WALK_CYCLE = WALK_GROUND_SPEED * WALK_DURATION * WORKER_SCALE;
/**
 * Carrier traffic is half loaded (shorter `LOAD_CARRY_STRIDE`) and half empty return walks, so the
 * prints use the mean of both cycles.
 */
const FOOT_CYCLE = WALK_CYCLE * (1 + LOAD_CARRY_STRIDE) / 2;
/** Hip (and so foot) offset from the body centre: `HIP_OFFSET.x` of worker-stepping.ts (0.083). */
const FOOT_HALF_SPACING = 0.083 * WORKER_SCALE;

/**
 * Every traffic-wear constant in one place (owner wear-2 2026-11-07, WEAR-3 2026-11-08): the CPU
 * feed and the ground/road shader looks (footprints, trampled earth, snow prints, wheel ruts) read
 * these values.
 */
export const TRAFFIC_WEAR_TUNING = {
  /** Field texels per world cell (one cell is one world unit). */
  texelsPerCell: 1,
  /** Ticks between wear updates; the fixed cadence keeps the CPU cost off the render path. */
  updateTicks: 20,
  /** Wear added to a texel each time a moving walker's or wheel's trail crosses it. */
  add: 32,
  /** Wear removed from each touched texel every `decayEveryUpdates` updates (slow fade). */
  decay: 1,
  decayEveryUpdates: 4,
  /** Trail sampling step in world units; consecutive samples join into a continuous line. */
  trailStep: 0.5,
  /** Moves shorter than this between two updates are standing still and wear nothing. */
  minMove: 0.05,
  /** Longer jumps (entering a building, teleports) restart the trail instead of drawing a line. */
  maxTrail: 4,
  /** Minimum real time between two GPU uploads of the field (fast forward changes it every frame). */
  uploadIntervalMs: 400,
  /** Share of a new crossing blended into a texel's stored trail line (direction and offset). */
  lineBlend: 0.25,
  /** A crossing turned more than this (radians) from an established line keeps the old line. */
  lineMaxTurn: 0.6,
  /** Stored line offset range from the texel centre (cells): cart centres sit up to ~1 cell away. */
  lineOffsetRange: 1.25,
  /** Walk cycle length (cells): a left and a right print per cycle (worker-locomotion.ts). */
  footCycle: FOOT_CYCLE,
  /** Left/right foot distance from the walking line (cells). */
  footHalfSpacing: FOOT_HALF_SPACING,
  /** Print size (cells): half the sole length and half its width at the ball. */
  footHalfLength: 0.086,
  footHalfWidth: 0.038,
  /** Toe-out angle of each print (radians). */
  footToeOut: 0.12,
  /** Superellipse exponents of the sole outline: 2 = ellipse; higher = blunter (toe end broad and round). */
  footHeelRoundness: 2.4,
  footToeRoundness: 4,
  /**
   * Normalized wear where each extra trodden line of prints appears: the first line already after
   * a few crossings, more lines (other walkers beside it) only where many steps really fell.
   */
  printLines: [[0.05, 0.3], [0.32, 0.55], [0.5, 0.78]] as const,
  /** Normalized wear where trampled earth between the prints starts and completes. */
  fillStart: 0.62,
  fillFull: 1,
  /** Trampled earth between prints stays partial and patchy; the prints carry the full colour. */
  fillShare: 0.6,
  /** Prints are pressed in: darker than the trampled earth and occluded. */
  printDarken: 0.32,
  /** Albedo factor of a print in sand: a shaded hollow of the same sand. */
  sandPrintShade: 0.74,
  printOcclusion: 0.35,
  /** Largest share of the ground albedo that turns into trampled earth (prints and fill). */
  groundStrength: 0.82,
  /** Trampled-earth albedo (linear), scaled by the local ground brightness to keep texture. */
  earth: [0.24, 0.16, 0.085] as const,
  /**
   * Packed-earth village yards (GROUND-PALETTE step 4): where traffic is heaviest the trampled earth turns into a
   * lighter, dusty, compacted floor (wear share where it starts / is full, and its linear albedo).
   */
  packedRange: [0.45, 0.8] as const,
  /**
   * Raw wear where the last grass tufts on a packed-earth yard thin out and are gone (ground-palette-4: the yards kept
   * 15 % of their tufts, which stood on the packed floor).
   */
  grassBare: [0.82, 0.97] as const,
  packedEarth: [0.33, 0.26, 0.18] as const,
  /**
   * Snow look: a sole is a cool, compressed hollow (never brown), between-print traffic packs to
   * grey-white snow, and the sun-facing rim catches a faint blue-white highlight.
   */
  snowPrint: [0.58, 0.66, 0.77] as const,
  snowPacked: [0.64, 0.71, 0.8] as const,
  /**
   * Snow packs into a continuous trail long before soil wears bare (GROUND-PALETTE step 3: packed snow paths
   * readable at normal distance): normalized wear where the packed band starts in snow (full ground) and where
   * the lite ground's tint starts and is full in snow (ground-palette-3: from 0.2 to 1 a light path showed no tint on
   * Minimal, which has no prints to carry it).
   */
  snowFillStart: 0.18,
  snowLiteStart: 0.06,
  snowLiteFull: 0.55,
  snowRim: [0.93, 0.97, 1] as const,
  snowRimStrength: 0.1,
  /** Extra shading on the sun-facing edge and the opposite, shaded side of a snow print. */
  snowSunShade: 0.18,
  /** Packed snow is smoother: share of the ground normal relief removed by traffic. */
  snowSmooth: 0.62,
  snowPrintSmooth: 0.24,
  /** Minimal (lite ground): only a cheap tint, and only on heavily used paths. */
  liteStart: 0.55,
  liteFull: 1,
  /** Dirt-road ruts: normalized cart wear where they start/complete, and the maximum darkening. */
  rutStart: 0.12,
  rutFull: 0.8,
  rutStrength: 0.42,
  /** Wheel contact distance from the cart's centre line (roman-handcart.ts), and the rut width. */
  wheelHalfGauge: HANDCART.wheelHalfGauge,
  rutHalfWidth: 0.04,
  /**
   * Paved roads: only heavy cart use leaves two narrow, faint grooves. Higher thresholds make them
   * temporary even before the shared field decay removes the rest; the stone texture stays readable.
   */
  pavedGrooveStart: 0.2,
  pavedGrooveFull: 0.8,
  pavedGrooveStrength: 0.5,
  pavedGrooveWidth: 0.06
} as const;

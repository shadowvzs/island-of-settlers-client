/**
 * SHIP-WIND: sail billow and flutter along the world wind, relative to each ship's heading. Presentation
 * only (no simulation effect); the vertex shader (ship-cloth-wind-glsl.ts) and this CPU reference share
 * the constants below, so tests can check the deformed cloth against ropes, masts and yards.
 *
 * Every sail vertex carries `clothWind` = (billow direction angle in the ship's xz plane, rest belly
 * depth, flutter weight, normal share). The authored geometry is the rest shape at `restBillow`; the
 * belly scales with the billow factor, so cloth pinned to a yard, mast or sheet (depth 0, flutter 0)
 * never moves.
 */
export const SHIP_CLOTH_WIND = {
  attribute: "clothWind",
  /** Billow factor of the authored rest shape (clear-weather wind from astern). */
  restBillow: .5,
  /** Billow factor range from calm to storm wind, before the fill and the gusts. */
  calmBillow: .4,
  stormBillow: .8,
  /** Share of the belly a luffing sail (head to wind) keeps. */
  luffBillow: .35,
  /** Head-wind component where the sail starts to luff, and where it hangs fully limp. */
  luffStart: .3,
  luffFull: .95,
  /** Wind speed (world units) mapped to strength 0 and 1: clear weather is about .87, a storm 2.1 (rain wind). */
  calmWind: .5,
  windRange: 1.55,
  /** Downwind shift of the belly per unit depth at full strength (a beam wind pushes it to leeward). */
  leeShift: .3,
  /** Free-edge flutter amplitude (ship units) in calm and the extra in a storm; luffing doubles it. */
  flutterCalm: .004,
  flutterStorm: .012,
  /** Slow breathing gusts. */
  gustSlow: [.7, .1],
  gustFast: [1.9, .05],
  /** Flutter ripples: angular speed and spatial wave vector (ship units). */
  rippleA: [9, 6, 4.5, 6],
  rippleB: [14.3, -3.5, 8, 3],
  /** Bounding-sphere margin (ship units) for the largest offset. */
  boundsMargin: .2
} as const;

/** Per-vertex wind data: billow direction angle, rest belly depth, flutter weight, normal share. */
export type ShipClothWindVertex = readonly [angle: number, depth: number, flutter: number, normalShare: number];

/** The wind as one ship sees it: its object-space horizontal direction and the 0..1 strength. */
export interface ShipClothWindState {
  localX: number;
  localZ: number;
  strength: number;
  time: number;
  /**
   * Per-ship phase so neighbouring sails do not flap in step (the shader uses world x * .37 + z * .53).
   */
  phase: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** 0..1 strength of a world wind vector of this length. */
export const shipClothStrength = (windLength: number) =>
  clamp01((windLength - SHIP_CLOTH_WIND.calmWind) / SHIP_CLOTH_WIND.windRange);

/** 1 with the wind from astern or abeam, falling towards 0 head to wind. */
export const shipClothFill = (localX: number, localZ: number) => {
  const length = Math.hypot(localX, localZ);
  if (length < 1e-5) return 1;
  return 1 - smoothstep(SHIP_CLOTH_WIND.luffStart, SHIP_CLOTH_WIND.luffFull, -localZ / length);
};

/** Belly scale relative to the rest shape (1 = the authored rest belly). */
export const shipClothBillowRatio = (state: ShipClothWindState) => {
  const { calmBillow, gustFast, gustSlow, luffBillow, restBillow, stormBillow } = SHIP_CLOTH_WIND;
  const fill = shipClothFill(state.localX, state.localZ);
  const gust = 1 + Math.sin(state.time * gustSlow[0] + state.phase) * gustSlow[1] +
    Math.sin(state.time * gustFast[0] + state.phase * 1.3) * gustFast[1];
  const billow = (luffBillow + (1 - luffBillow) * fill) * (calmBillow + (stormBillow - calmBillow) * state.strength);
  return billow * gust / restBillow;
};

/** The deformed position of one cloth vertex (CPU reference of the vertex shader). */
export const shipClothPoint = (position: readonly number[], vertex: ShipClothWindVertex,
  state: ShipClothWindState): [number, number, number] => {
  const [angle, depth, flutter] = vertex;
  const { flutterCalm, flutterStorm, leeShift, rippleA, rippleB } = SHIP_CLOTH_WIND;
  const directionX = Math.cos(angle), directionZ = Math.sin(angle);
  const fill = shipClothFill(state.localX, state.localZ);
  const length = Math.hypot(state.localX, state.localZ) || 1;
  const windX = state.localX / length, windZ = state.localZ / length;
  const along = windX * directionX + windZ * directionZ;
  const lee = depth * leeShift * state.strength * fill;
  const ripple = (wave: readonly number[], phase: number) => Math.sin(state.time * wave[0]! +
    position[0]! * wave[1]! + position[1]! * wave[2]! + position[2]! * wave[3]! + phase);
  const wave = (ripple(rippleA, state.phase) + .5 * ripple(rippleB, state.phase * 1.7)) / 1.5;
  const amplitude = flutter * (flutterCalm + flutterStorm * state.strength) * (2 - fill);
  const push = depth * (shipClothBillowRatio(state) - 1) + amplitude * wave;
  return [position[0]! + directionX * push + (windX - directionX * along) * lee,
    position[1]!,
    position[2]! + directionZ * push + (windZ - directionZ * along) * lee];
};

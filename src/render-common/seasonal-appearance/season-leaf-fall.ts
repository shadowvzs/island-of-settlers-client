/** P1 seasonal falling leaves (seasons plan 4): rate and reach. Off on Minimal (no weather particles). */
export const SEASON_LEAF_FALL = Object.freeze({
  /** Leaf size relative to the crown radius (the felling leaves use 0.09). */
  leafSize: 0.08,
  /** New leaves per second at full fall around the focus. */
  leavesPerSecond: 34,
  /** Half width (cells) of the square round the focus whose broadleaf trees drop leaves. */
  radiusCells: 22,
  /** The focus moves this far (cells) before the nearby trees are collected again. */
  refreshCells: 4
});

/** Capacity of the leaf pool: High 192, the other particle presets 96 (plan 4). */
export const getSeasonLeafCapacity = (weatherParticles: boolean, grassSamples: number) => {
  if (!weatherParticles) return 0;
  return grassSamples >= 10 ? 192 : 96;
};

/**
 * 0..1 leaf fall: a steady fall through autumn (strongest late in the turn) and the main drop while the dormant
 * weight rises; none in the spring bud-out, summer or the monsoon.
 */
export const getSeasonLeafFall = (season: { autumn: number; dormant: number; spring: number }) => {
  if (season.spring > 0) return 0;
  const autumn = season.autumn * 0.55;
  const dropping = season.dormant > 0 && season.dormant < 1 ? 1 - Math.abs(season.dormant * 2 - 1) * 0.6 : 0;
  return Math.min(1, autumn + dropping);
};

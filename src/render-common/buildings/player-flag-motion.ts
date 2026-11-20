export const PLAYER_FLAG_POSES = 8;
export const PLAYER_FLAG_PERIOD = 2.8;

/** Travel from the pinned hoist to the free edge; calm cloth hangs under gravity. */
export const playerFlagVertex = (x: number, y: number, phase: number | null) => {
  const free = x / 0.43;
  if (free < 0.00001) return [x, y, 0] as const;
  const height = (y - 0.115) / 0.27;
  if (phase === null)
    return [
      x * 0.18,
      y - 0.24 * Math.pow(free, 1.1),
      Math.sin(free * 10 + height * 3) * 0.012 * free
    ] as const;
  const travel = free * 8.5 - phase;
  const fold = Math.sin(travel + height * 2.4);
  const ripple = Math.sin(free * 17 - height * 4.2 - phase * 2);
  return [
    x * (0.96 + 0.025 * fold * free),
    y - 0.037 * free + Math.sin(travel + height * 1.7) * 0.028 * free,
    fold * 0.095 * Math.pow(free, 1.2) + ripple * 0.020 * free * free
  ] as const;
};

/** Blend adjacent samples of the same travelling cloth wave without allocating per frame. */
export const playerFlagWaveWeights = (travel: number, lift: number, weights: number[]) => {
  const cycle = ((travel % PLAYER_FLAG_PERIOD) + PLAYER_FLAG_PERIOD) % PLAYER_FLAG_PERIOD;
  const frame = (cycle / PLAYER_FLAG_PERIOD) * PLAYER_FLAG_POSES;
  const first = Math.floor(frame),
    blend = frame - first;
  weights.fill(0);
  weights[first] = (1 - blend) * lift;
  weights[(first + 1) % PLAYER_FLAG_POSES] = blend * lift;
};

/** Secondary gusts vary cloth lift independently from the travelling wave. */
export const playerFlagWindWeights = (time: number, strength: number, weights: number[]) => {
  const wind = Math.max(0, Math.min(1, strength * 1.35));
  const gust = 0.84 + Math.sin(time * 0.73) * 0.1 + Math.sin(time * 1.93) * 0.06;
  const travel = time * (0.7 + wind * 0.6) + Math.sin(time * 0.43) * 0.13;
  playerFlagWaveWeights(travel, wind * gust, weights);
};

/**
 * One cloth vertex under the wind: the calm hang blended with the weighted travelling poses
 * (weights from `playerFlagWindWeights`). Writes into `out` to stay allocation free per frame.
 */
export const blendPlayerFlagVertex = (x: number, y: number, weights: readonly number[], out: number[]) => {
  const lift = weights.reduce((sum, weight) => sum + weight, 0);
  const calm = playerFlagVertex(x, y, null);
  out[0] = calm[0] * (1 - lift); out[1] = calm[1] * (1 - lift); out[2] = calm[2] * (1 - lift);
  for (let pose = 0; pose < PLAYER_FLAG_POSES; pose++) {
    const weight = weights[pose]!;
    if (!weight) continue;
    const point = playerFlagVertex(x, y, pose / PLAYER_FLAG_POSES * Math.PI * 2);
    out[0] += point[0] * weight; out[1] += point[1] * weight; out[2] += point[2] * weight;
  }
  return out;
};

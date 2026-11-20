/** Fore-and-aft lateen under one long diagonal yard; deck/navigation contracts stay unchanged. */
export const PERSIAN_LATEEN_SAIL = {
  peak: [.105, 2.22, -.94], tack: [.105, .75, .96], clew: [.12, .70, -.78],
  yardX: .070,
} as const;

/** Cartesian cloth coordinates keep the phoenix upright instead of squeezing it toward a corner. */
export const persianLateenUV = (point: readonly number[]) => [
  (.96 - point[2]!) / 1.90, (point[1]! - .70) / 1.52,
] as const;

/** Rest belly depth (ship units) at the cloth's centroid; it vanishes on all three edges. */
export const PERSIAN_LATEEN_BELLY = .125;
export const persianLateenBelly = (u: number, v: number) => Math.max(0, 27 * u * v * (1 - u - v)) * PERSIAN_LATEEN_BELLY;

/** The rest cloth at barycentric (u towards the peak, v towards the clew); the wind shader moves it. */
export const persianLateenPoint = (u: number, v: number) => {
  const { clew, peak, tack } = PERSIAN_LATEEN_SAIL, w = 1 - u - v;
  return [tack[0] * w + peak[0] * u + clew[0] * v + persianLateenBelly(u, v),
  tack[1] * w + peak[1] * u + clew[1] * v,
  tack[2] * w + peak[2] * u + clew[2] * v] as const;
};

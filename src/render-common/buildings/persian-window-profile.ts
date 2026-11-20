/** Arched void cut through a rounded wall; all dimensions are normalized to that room's unit box. */
export interface PersianWallWindow {
  angle: number;
  bottom: number;
  halfAngle: number;
  /** Physical rise / half-width for an original pointed crown; omitted means a rounded arch. */
  pointedAspect?: number;
  rise: number;
  spring: number;
}

export const wrapPersianWallAngle = (angle: number) => {
  const turn = Math.PI * 2;
  return ((angle + Math.PI) % turn + turn) % turn - Math.PI;
};

/** The same elliptical crown is used by wall tessellation and opening/contact queries. */
export const persianWindowCrown = (window: PersianWallWindow, angle: number): number | null => {
  const distance = wrapPersianWallAngle(angle - window.angle);
  if (Math.abs(distance) > window.halfAngle + 1e-9) return null;
  const x = Math.sin(distance) / Math.sin(window.halfAngle);
  if (window.pointedAspect !== undefined) {
    const aspect = window.pointedAspect, centre = (aspect * aspect - 1) / 2;
    const height = Math.sqrt(Math.max(0, (centre + 1) ** 2 - (Math.abs(x) + centre) ** 2));
    return window.spring + window.rise * height / aspect;
  }
  return window.spring + window.rise * Math.sqrt(Math.max(0, 1 - x * x));
};

export const persianWindowAngles = (windows: readonly PersianWallWindow[], detailed: boolean): number[] => {
  const slices = detailed ? 8 : 4, angles: number[] = [];
  for (const window of windows) for (let index = 0; index <= slices; index++) {
    const offset = Math.asin(Math.sin(-Math.PI / 2 + index / slices * Math.PI) * Math.sin(window.halfAngle));
    angles.push(wrapPersianWallAngle(window.angle + offset));
  }
  return angles;
};

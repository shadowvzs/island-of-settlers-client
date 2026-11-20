import type { BuildingRecipe } from "./building-recipe";

/** New standalone monument; retired Temple ID7 remains reserved. */
export const MONUMENT_TYPE_ID = 7;
/** Union of both quality bounds of all four supplied national assets, with a clear plot margin. */
export const MONUMENT_PLOT = [9, 9] as const;
export const MONUMENT_SCALE = 1;
export const MONUMENT_HEIGHT = 11.868;
export const MONUMENT_ASSETS = {
  indigenous: { high: 31820, minimal: 5960, height: 6, base: [7.4, 7.4] },
  chinese: { high: 28248, minimal: 5820, height: 4.7299, base: [7.7, 5.1] },
  persian: { high: 14952, minimal: 1212, height: 4.886149, base: [7.5, 5.995] },
  maya: { high: 5580, minimal: 420, height: 5.71, base: [7.925001, 8.088751] },
  roman: { high: 8932, minimal: 1420, height: 4.971386, base: [8, 8] },
  viking: { high: 8176, minimal: 2898, height: 9.37, base: [7.2, 8.4] },
  nubian: { high: 6532, minimal: 1230, height: 4.07, base: [8, 8] },
  japanese: { high: 24220, minimal: 5650, height: 11.867587, base: [7.8, 7.8] }
} as const;

/** Collision/plot metadata only; the native renderer loads the supplied GLBs. No interior job is assigned. */
export const monumentRecipe = (): BuildingRecipe => ({
  parts: [{ shape: "box", surface: "stone", position: [0, MONUMENT_HEIGHT / 2 - .08, 0],
    size: [8.4, MONUMENT_HEIGHT + .16, 8.4], stage: 4 }],
  door: [0, 0, 4.25], doorProfile: "flat", hideDoor: true, hideFlag: true,
  workerExit: [0, 0, 4.35], workPoint: [0, 0, 4.35], mechanism: [0, 0, 0]
});

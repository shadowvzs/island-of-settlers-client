import { WORKER_HEIGHT } from "../workers/worker-dimensions";

// Horse height is measured at the withers, not the ears. A 15-hand working horse = 1.524m.
// Human art reference: 1.75m. Source asset's measured withers: mounts/horse/build.json.
export const HORSE_SOURCE_WITHERS = 1.0266;
export const HORSE_WITHERS_HEIGHT = WORKER_HEIGHT * 1.524 / 1.75;
export const HORSE_WORLD_SCALE = HORSE_WITHERS_HEIGHT / HORSE_SOURCE_WITHERS;
/** Existing conservative mounted navigation footprint; planting must preserve this usable passage. */
export const MOUNTED_NAVIGATION_RADIUS = 1.05;

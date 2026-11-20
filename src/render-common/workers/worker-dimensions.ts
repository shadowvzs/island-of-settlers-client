/**
 * World height of a worker (map cells); the generated model is 1.16 model units tall. 1.25x the
 * earlier 0.85 (owner): readable at the RTS zoom; the walk speed follows (longer steps).
 */
export const WORKER_HEIGHT = 1.0625;
/** Model units to world cells. */
export const WORKER_SCALE = WORKER_HEIGHT / 1.16;
/** Physical body radius (cells), retained for building and doorway clearance. */
export const WORKER_RADIUS = 0.2;
/**
 * Calibrated unit avoidance. The first owner-requested reduction was 33%; this second step
 * (0.67 → 0.58) trims another 13.4% without shrinking bodies or door clearance. Horse and cart
 * clearances stay separate and keep their physical length.
 */
export const WORKER_COLLISION_SCALE = 0.58;
export const WORKER_COLLISION_RADIUS = WORKER_RADIUS * WORKER_COLLISION_SCALE;

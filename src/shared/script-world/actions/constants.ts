/** Constants of the map script's presence and movement actions (TRG5a, trigger design §5.2.1/§5.2.2, §6.6). */

/** Degrees → radians (script angles are authored in degrees). */
export const DEGREES_TO_RADIANS = Math.PI / 180;

/** Nearest free cells a spawn or teleport looks at beyond its region in guaranteed mode (cells). */
export const GUARANTEED_SEARCH_RADIUS = 24;
/** A march that stopped this close (cells) to the region centre counts as arrived (formation places). */
export const ARRIVAL_RADIUS = 2.5;

/** Spawn count bound of the catalogue (`count ≤ 64`). */
export const MAX_SPAWN_COUNT = 64;

/**
 * Clips a script may play on a unit (existing worker clips only), with the simulation seconds one loop lasts. The
 * simulation times the action with these; the renderer only shows the clip while the action runs.
 */
export const SCRIPT_CLIP_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  build_hammer: 1.2,
  chop_tree: 1.4,
  dig: 1.6,
  idle_breathe: 2,
  look_around: 2.4,
  plant_seedling: 2,
  spyglass_scan: 3
});
export const SPYGLASS_CLIP = "spyglass_scan";
export const SPYGLASS_TOOL = "spyglass";
/** `lookSpyglass` without `seconds`. */
export const DEFAULT_SPYGLASS_SECONDS = 3;

/** Unit kinds of the catalog the presence/movement actions handle in v1. */
export const SOLDIER_KIND = "soldier";

/** The list fields of the saved action state. */
export const ACTION_STATE_LISTS = ["fades", "hidden", "invulnerable", "looks", "speech", "units"] as const;

/** Spacing that keeps a spawned or teleported unit clear of another body (the spawn rule's distance). */
export const BODY_CLEARANCE = .38;

/** Weather states a script `setWeather` may set (the catalogue's `WEATHER_STATES`; ENV0). */
export const SCRIPT_WEATHER: readonly string[] = ["clear", "rain", "snow"];

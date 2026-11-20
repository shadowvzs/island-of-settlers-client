import { HOURS_PER_DAY } from "../environment/constants";
import { ISLAND_THEMES } from "../world/generation/island-themes";

/** Constants of the island's world environment (ENV0, `world-environment.ts`). */

/** Label of the weather chain's own random stream (derived from the world seed). */
export const WEATHER_SEED_LABEL = "worldWeather";
/** Start hour of a map without environment defaults (the presentation's "day" preset). */
export const DEFAULT_START_HOUR = 12;
/** The snowy share (of 255) above which an island has the winter climate. */
export const WINTER_SHARE = 127.5;
export const SNOWY_THEME = ISLAND_THEMES.indexOf("snowy");
/** Every this-many vertices are sampled for the island's climate. */
export const CLIMATE_SAMPLE_STRIDE = 7;
/** At most one day of hours is reported at once (a long jump). */
export const MAX_REPORTED_HOURS = HOURS_PER_DAY;
/** Every state of the seeded weather chain (save check). */
export const WORLD_WEATHER_STATES: readonly unknown[] = ["clear", "cloudy", "rain", "snow", "storm"];

/** Constants of the script watches (`cell-watch.ts`, `proximity-watch.ts`). */

/** First size of the per-uid arrays; they double when a larger uid appears. */
export const WATCH_INITIAL_CAPACITY = 256;
/** Most static "came near" circles watched at once (list ids are 16 bit); further targets are ignored. */
export const STATIC_ZONE_LIMIT = 512;
/** Most moving "came near" targets tested per unit and tick. */
export const MOVING_ZONE_LIMIT = 32;
/** Fields of a building that decide type/family matching (uid, type, owner, level): a change re-resolves circles. */
export const BUILDING_SIGNATURE_FIELDS = 4;

/** The members' pool of every building (`script-world-members.ts`): what `factionBuildingCount` counts. */
export const BUILDING_POOL = "building";

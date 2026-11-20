import { secondsToTicks } from "../../../../../island-of-settlers-shared/src/time/constants";
import { type CommanderLevel, type CommanderPace, VERY_HARD_PACE } from "../../balance/commander-profiles";
import { PLOT_GROUND_MARGIN } from "../constants";

/**
 * The decision layers of a computer faction (enemy economy AI plan §3.3), in the order they run when several are due
 * on one tick: strategic posture, build planner, economy manager, military link.
 */
export const FACTION_AI_LAYERS = ["strategic", "planner", "economy", "military"] as const;

/** Seconds between two decisions of each layer, in `FACTION_AI_LAYERS` order (plan §3.3 table). */
const FACTION_AI_LAYER_SECONDS = [10, 2, 1, 3] as const;

/** Whole game ticks between two decisions of each layer, in `FACTION_AI_LAYERS` order. */
export const FACTION_AI_LAYER_TICKS: readonly number[] = FACTION_AI_LAYER_SECONDS.map(secondsToTicks);

/**
 * Factions take a quarter of each interval as their slot (`(period × (faction % 4)) / 4`, plan §3.3), so four
 * factions never decide one layer on the same tick.
 */
export const FACTION_AI_CLOCK_SLOTS = 4;

/** A13 illegal-read probe site (plan §3.2): the strategic layer's read of its faction's known enemy soldiers. */
export const FACTION_AI_PROBE_KNOWN_SOLDIERS = "economyAi.knownSoldiers";

/** The tick-phase key of the economy AI (`tick-phase-profile.ts`, plan §6.2 decision budget). */
export const FACTION_AI_TICK_PHASE = "economyAi";

/** The one mode a style applies to (plan §2.1). */
export const DEVELOP_MODE = "develop";

export const INVALID_FACTION_AI_SAVE = "Invalid faction AI state";

/** A `develop` faction commits to no new goal while this many of its construction sites are unfinished. */
export const MAX_OPEN_SITES = 3;

/** The most open build goals one strategic decision scores (plan §3.3 quota). */
export const MAX_SCORED_BUILD_GOALS = 8;

/** `AI_POSTURES` indexes: `grow` while the faction knows of no enemy soldier, `fortify` while it does. */
export const GROW_POSTURE = 0;
export const FORTIFY_POSTURE = 1;

/** The layer that carries a script's goal out (`setFactionGoal`, EAI4c): the military link (plan §3.3). */
export const FACTION_GOAL_LAYER = FACTION_AI_LAYERS.indexOf("military");
/** Strength points a goal's attack musters before it sets out: four full-health rank-0 swordsmen (not tuned). */
export const GOAL_ATTACK_STRENGTH = 400;
/** The bound of a saved goal area's coordinates and radius (the strategic contract's area bound). */
export const GOAL_AREA_LIMIT = 2048;
/** Tiles round a faction's base that a `defend` or `hold` goal without a region posts; a point region's radius. */
export const GOAL_POST_RADIUS = 12;

/**
 * How a computer faction's own strategic intents scale with its level (EAI4b; owner 2026-11-16: balance is low
 * priority, so one small table, not tuned): the first tick an attack, raid or scout may be ordered, the strength an
 * attack musters, the own-to-known enemy strength an offensive needs (percent), whether raids and full attacks are
 * allowed, the raid party it keeps back, the back-off after a failed offensive (times the failures in a row) and the
 * rest after any finished offensive. Easy (owner 2026-11-17) makes only rare, small, late raids: none before 20 game
 * minutes, four soldiers at most, never a full attack, then at most one every 13 minutes.
 */
export interface StrategyLevel {
  attackRatioPercent: number;
  attackStrength: number;
  attacks: boolean;
  firstAttackTicks: number;
  /** Ticks after a finished (done, failed or broken) offensive before the next one; 0: none. */
  offensiveRestTicks: number;
  /**
   * The most soldiers a raid calls up from the depot, kept free of the garrisons' filling pass (and a raid's least
   * party, `RAID_MIN_SOLDIERS`, out of new towers); 0: none kept, a raid calls up to the director's party maximum.
   */
  raidParty: number;
  raids: boolean;
  retryTicks: number;
}

export const STRATEGY_LEVELS: Readonly<Record<CommanderLevel, StrategyLevel>> = Object.freeze({
  easy: { attackRatioPercent: 150, attackStrength: 400, attacks: false, firstAttackTicks: secondsToTicks(1200),
    offensiveRestTicks: secondsToTicks(780), raidParty: 4, raids: true, retryTicks: secondsToTicks(180) },
  hard: { attackRatioPercent: 100, attackStrength: 800, attacks: true, firstAttackTicks: secondsToTicks(120),
    offensiveRestTicks: 0, raidParty: 0, raids: true, retryTicks: secondsToTicks(60) },
  medium: { attackRatioPercent: 120, attackStrength: 600, attacks: true, firstAttackTicks: secondsToTicks(300),
    offensiveRestTicks: 0, raidParty: 0, raids: true, retryTicks: secondsToTicks(120) }
});
/** Tiles beyond the base post's radius in which a known enemy soldier threatens the base (a defend intent). */
export const STRATEGY_THREAT_RING = 12;
/** Radius of the hold post at the faction's front (its building nearest to the nearest known enemy soldier). */
export const STRATEGY_HOLD_RADIUS = 20;
/** The least strength a raid sets out with: two full-health rank-0 swordsmen. */
export const STRATEGY_RAID_STRENGTH = 200;
/** The soldiers of that least raid (a level keeping a raid party keeps them out of new towers). */
export const RAID_MIN_SOLDIERS = 2;
/** An offensive is broken (retreat) once the faction's strength falls below this share of the known enemy's. */
export const STRATEGY_RETREAT_PERCENT = 50;
/**
 * Own buildings from which a worker tool shortage pulls the Metalworks and its iron chain (EAI4-FOLLOWUP): an opening
 * plays its style's program, a grown town makes its own tools.
 */
export const TOOL_SHORTAGE_MIN_BUILDINGS = 10;
/** Stored soldiers one military-layer decision releases into the field for the faction's offensive (≤ one march). */
export const RESERVE_RELEASE_MAX = 8;
/** Failed offensives in a row the back-off counts at most. */
export const STRATEGY_MAX_FAILURES = 4;

/** Build goal scores are hundredths of a weight point, so the program's percentages stay whole numbers. */
export const GOAL_SCORE_SCALE = 100;
/** A whole percentage (the commitment margin is a share of it). */
export const FULL_PERCENT = 100;

/**
 * How a `develop` faction's level paces it (plan §5.1; owner 2026-11-16: balance is low priority, one small table):
 * every layer's interval as a percentage of §3.3's (reaction time, 1.5 / 1.0 / 0.75) and the build goal commitment
 * margin as a percentage of its program's (decision quality: an easy faction clings to a stale goal, a hard one
 * switches sooner). Medium is the P3/P4 behaviour; Very hard plays hard at A14-5's faster pace. Never information
 * or a larger candidate count.
 */
export interface DevelopPace {
  cadencePercent: number;
  commitmentPercent: number;
}

const HARD_CADENCE_PERCENT = 75;

export const DEVELOP_PACES: Readonly<Record<CommanderPace, DevelopPace>> = Object.freeze({
  easy: { cadencePercent: 150, commitmentPercent: 200 },
  hard: { cadencePercent: HARD_CADENCE_PERCENT, commitmentPercent: 50 },
  medium: { cadencePercent: 100, commitmentPercent: 100 },
  veryHard: { cadencePercent: Math.round(HARD_CADENCE_PERCENT * VERY_HARD_PACE), commitmentPercent: 50 }
});

const layerTicksAt = ({ cadencePercent }: DevelopPace): readonly number[] =>
  Object.freeze(FACTION_AI_LAYER_TICKS.map(ticks => Math.round(ticks * cadencePercent / FULL_PERCENT)));

/** Whole game ticks between two decisions of each layer of a `develop` faction at each pace. */
export const DEVELOP_LAYER_TICKS: Readonly<Record<CommanderPace, readonly number[]>> = Object.freeze({
  easy: layerTicksAt(DEVELOP_PACES.easy),
  hard: layerTicksAt(DEVELOP_PACES.hard),
  medium: layerTicksAt(DEVELOP_PACES.medium),
  veryHard: layerTicksAt(DEVELOP_PACES.veryHard)
});

export const INVALID_DEVELOP_SAVE = "Invalid develop state";
/** A saved goal key (the catalog's key pattern) and its limits (the build program validator's). */
export const BUILD_GOAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const BUILD_GOAL_KEY_MAX_LENGTH = 64;
export const MAX_BUILD_GOALS = 32;
export const MAX_BUILD_GOAL_TARGET = 60;

/** The most own buildings one economy manager decision examines (plan §3.3 quota, rolling cursor). */
export const MAX_EXAMINED_BUILDINGS = 16;

/** What the economy manager wants of a producer: keep it as it is, run it, or pause it (plan §3.6). */
export const KEEP_PRODUCTION = 0;
export const RUN_PRODUCTION = 1;
export const PAUSE_PRODUCTION = 2;

/** The survey job the AI geologist walks out with (`assignSurveyJob`). */
export const GEOLOGIST_JOB = "Geologist";

/** Mine zone ids are 16-bit cell values from 1 (`world.mineZone`). */
export const MAX_MINE_ZONE_ID = 0xffff;
/** The discovered bits are saved whole bytes (eight cells each). */
export const BITS_PER_BYTE = 8;

/** Build planner quotas per decision (plan §3.3): cache entries scored, full placement checks, road tries. */
export const PLANNER_CANDIDATES = 24;
export const PLANNER_FULL_CHECKS = 4;
export const PLANNER_ROAD_TRIES = 2;
/** Cache keys one decision reads at most while it looks for candidates (resource goals skip barren plots). */
export const PLANNER_SCANNED_KEYS = 256;

/**
 * Candidate plot kinds (plan §3.5): ordinary land and a mine on a deposit. A waterfront type (harbour, shipyard)
 * shares the land class of its footprint; its open-sea test reads the live terrain as a match filter.
 */
export const PLOT_KIND_LAND = 0;
export const PLOT_KIND_MINE = 1;
/** Quarter turns a plot may take; an entry is `cornerCell × PLOT_ROTATIONS + rotation`. */
export const PLOT_ROTATIONS = 4;
/** Footprint widths/depths a plot class key packs (class = kind × span² + width × span + depth). */
export const PLOT_CLASS_SPAN = 64;

/** Failed plots remembered per faction (plan §3.5 negative memo); the oldest gives way. */
export const PLOT_MEMO_CAPACITY = 64;
/** A failed plot is retried once this long passed even if nothing the memo watches changed. */
export const PLOT_MEMO_SECONDS = 180;
/** Cells round a failed plot whose change frees it (entrance lane, signpost, apron). */
export const PLOT_MEMO_HALO = 3;
/** Heights are fingerprinted at this many steps per unit (exact enough to see any leveling). */
export const PLOT_MEMO_HEIGHT_STEPS = 1024;

/** Goal score (plan §3.5): resources counted this many cells round a plot, at most this many. */
export const RESOURCE_SAMPLE_RADIUS = 8;
export const RESOURCE_SAMPLE_CAP = 64;
/** One resource in reach outweighs this many places of the static (depot distance) order. */
export const RESOURCE_WEIGHT = 2;
/** Free field cells counted this many cells round a farm or forester plot. */
export const FIELD_SAMPLE_RADIUS = 6;
/**
 * Corners within this many cells of a change are re-tested: the pre-check reads a lane of `PLOT_SPACING` and
 * heights `PLOT_GROUND_MARGIN` beyond the plot.
 */
export const PLOT_RETEST_REACH = PLOT_GROUND_MARGIN;
/** The watched window: the territory's cells with the reach of every pre-check read (one more for vertices). */
export const PLOT_WATCH_MARGIN = PLOT_GROUND_MARGIN + 1;
/** Packing of a watched cell: `occupied` (0-3), a water/cliff flag, the slope class, the ground class. */
export const PLOT_WATCH_OCCUPIED_BITS = 3;
export const PLOT_WATCH_WATER_OR_CLIFF = 4;
export const PLOT_WATCH_SLOPE_SHIFT = 3;
export const PLOT_WATCH_SLOPE_BITS = 3;
export const PLOT_WATCH_GROUND_SHIFT = 5;
export const PLOT_WATCH_GROUND_BITS = 7;
/** 32-bit FNV-1a offset and prime of the negative memo's plot fingerprint. */
export const FINGERPRINT_OFFSET = -2128831035;
export const FINGERPRINT_PRIME = 16777619;
/** The territory flag sits above the `occupied` value (0-3) in a fingerprinted cell. */
export const PLOT_MEMO_OWNED_SHIFT = 2;
/** The range of a saved 32-bit memo field. */
export const INT32_MIN = -0x80000000;
export const INT32_MAX = 0x7fffffff;
export const PLOT_WATCH_ROAD = 256;
/** Values per territory source in the plot cache's identity record: uid, x, z, radius. */
export const PLOT_SOURCE_FIELDS = 4;
/** A scanned corner's verdict bits: the straight footprint (turns 0/2) passes, the turned one (turns 1/3). */
export const PLOT_VERDICT_STRAIGHT = 1;
export const PLOT_VERDICT_TURNED = 2;
/**
 * What a planner decision did: nothing to do, a site placed, the goal refused (no plot, type or stock), or every
 * waiting candidate refused while the memo still has room (the next decision tries the plots after them).
 */
export const PLANNER_IDLE = 0;
export const PLANNER_PLACED = 1;
export const PLANNER_REFUSED = 2;
export const PLANNER_RETRY = 3;
/** A waiting placement's saved road: at most this many coordinates (x, z pairs). */
export const PLANNER_PENDING_ROAD_VALUES = 8192;
/** The steps of a waiting planner placement, one per tick: real plot check, road target, placement. */
export const PLANNER_STAGE_CHECK = 0;
export const PLANNER_STAGE_ROAD = 1;
export const PLANNER_STAGE_PLACE = 2;
/** Why the planner gave a goal or a plot up, as the dev overlay's probe hears it (never saved, never decided on). */
export const NO_CANDIDATE_PLOT = "No candidate plot";
export const EVERY_CHECKED_PLOT_REFUSED = "Every checked plot refused";
export const NO_ROAD_LINK = "No road link";
export const SITE_NOT_PLACED = "Site not placed";
/** A `maintain` action the probe hears: done, or refused without a reason of its own (a wall repair's backoff). */
export const MAINTAIN_DONE = "done";
export const MAINTAIN_REFUSED = "No load, stock or way";

/** Soldiers one military-layer decision sends into the faction's garrison buildings (plan §3.3 quota). */
export const SOLDIERS_PER_GARRISON_DECISION = 4;
/** Garrison passes: a first soldier for every building, then each to its target (EAI4a). */
export const GARRISON_PASSES = 2;
/** Recruits one Academy order asks for; the next order waits until the queue is empty. */
export const RECRUITS_PER_ORDER = 1;
/** Idle settlers a recruit order leaves for the faction's other jobs. */
export const RECRUIT_SPARE_SETTLERS = 1;
/** The troop the economy trains when the director asks for none: a swordsman with a shield (owner rule). */
export const DEFAULT_RECRUIT = "shield";
/** Refusals of one goal (not a mine) after which the faction expands its territory with a garrison building. */
export const EXPANSION_REFUSALS = 2;
/** No deposit to expand towards (`expansionTarget`): an expansion then takes the farthest edge plot. */
export const NO_EXPANSION_TARGET = -1;
/** An expansion building stands at least this share of the farthest own plot's distance from home (EAI4a). */
export const EXPANSION_BAND_PERCENT = 50;

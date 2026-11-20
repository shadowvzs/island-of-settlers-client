/**
 * Failed local route-repair attempts in a row before a walker's navigation recovery cools down;
 * a statically blocked foot walker then re-plans its whole remaining way once (perf lane 2026-11-07).
 */
export const STUCK_REPAIR_ATTEMPTS = 2;
/** Seconds a hunter's chase follows its route before it re-plans towards the moving prey. */
export const HUNT_REPLAN_SECONDS = 1;
/** Monument harbour defenders: the melee troops every nation fields (the tavern troops without archers). */
export const MONUMENT_DEFENDER_TYPES: readonly ("heavy" | "shield")[] = ["shield", "heavy"];
/** Mixes a start's identity into the Monument defender draw, so neighbouring starts differ. */
export const MONUMENT_GARRISON_SEED_MIX = 0x4d4f4e55;
/** Hex digits of a text fingerprint read as a campaign map's 32-bit Monument defender seed. */
export const CAMPAIGN_GARRISON_SEED_DIGITS = 8;
export const HEX_RADIX = 16;

/** FISHER-BOAT (plan 2026-11-11 §1.2): water faster than this at a cell corner is a river. */
export const BOAT_RIVER_FLOW_MIN = .02;
/** Cells this close to a river bed (channels, estuaries, mouths) are river water, never boat water. */
export const BOAT_RIVER_DISTANCE_MIN = 1.5;
/** An enclosed lake needs this many skiff-clear cells; ponds and oases stay rod water. */
export const BOAT_LAKE_MIN_CLEAR_CELLS = 48;
/** Cells around a skiff-clear cell that must all be boat water (hull plus oars, ~1 tile). */
export const BOAT_MASK_RADIUS = 1;
/** A boat is lowered from a low beach only: stance height above the water surface. */
export const BOAT_MAX_BANK_HEIGHT = .3;
/** Height difference across the parked hull's beam (no launching across a side slope). */
export const BOAT_MAX_LAUNCH_ROLL = .15;
/**
 * The launching fisher stands on the closest dry stand behind the visible waterline (FISHER-POLISH, owner
 * 2026-11-11): from this inset up the sand to the farthest one, in steps.
 */
export const BOAT_STANCE_NEAREST = .25;
export const BOAT_STANCE_FARTHEST = .85;
export const BOAT_STANCE_STEP = .05;
/** The parked bow just touches the wet sand at the visible waterline; the rest of the hull floats. */
export const BOAT_BOW_ON_SAND = .08;
/** Search step and reach (from the shore cell centre or the stance) for the visible waterline. */
export const BOAT_WATERLINE_STEP = .05;
export const BOAT_WATERLINE_REACH = 2;
/** Depth the skiff needs where it floats, one tile out from the waterline. */
export const BOAT_FLOAT_DEPTH = .15;
export const BOAT_FLOAT_REACH = 1;
/** The floating water joins skiff-clear water within this many cells. */
export const BOAT_MASK_JOIN_REACH = 2;
/** Launch slots on one shore stay this far apart (two parked boats side by side). */
export const BOAT_SLOT_SPACING = 1.4;
/** Ranked launch slots and net points kept per Fishery. */
export const BOAT_SITE_SLOTS = 4;
export const BOAT_SITE_NETS = 4;
/** Shore candidates evaluated per search, nearest first: bounds the one-off validation cost. */
export const BOAT_SLOT_EVALUATIONS = 384;
/** Walking routes searched per validation (each is a full ground path search). */
export const BOAT_SLOT_PATH_ATTEMPTS = 8;
/** Dry walking entry points tried behind a launch stance: from .5 to 1.5 tiles, every .25. */
export const BOAT_ENTRY_NEAREST = .5;
export const BOAT_ENTRY_FARTHEST = 1.5;
export const BOAT_ENTRY_STEP = .25;
/** Spacing of the hull samples checked under a parked boat. */
export const BOAT_FOOTPRINT_STEP = .4;
/** A launch keeps this margin beyond a road ribbon's half width. */
export const BOAT_ROAD_MARGIN = .1;
/** Net points: deep, open water rowed to over this many tiles from the launch water. */
export const BOAT_NET_MIN_DEPTH = .6;
export const BOAT_NET_SHORE_CLEARANCE = 3.5;
export const BOAT_NET_MIN_ROW = 3;
export const BOAT_NET_MAX_ROW = 8;
/** Net points of one or several fisheries stay this far apart. */
export const BOAT_NET_SPACING = 3;
/** Cell centres this close to a dry cell centre leave less than the net shore clearance to its edge. */
export const BOAT_NET_DRY_CENTRE_REACH = BOAT_NET_SHORE_CLEARANCE + .5;
/** Orthogonal grid steps for boat water flood fills and rowing distances. */
export const BOAT_FOUR_NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
/** The skiff ware a boat-mode Fishery owns (equipment: never pooled between storages). */
export const BOAT_WARE = "boat";
/** The campaign map-file validator reports this Play error as its own structured issue (C7a). */
export const LANDING_HARBOUR_MISSING = "Place the landing harbour before Play";
/** Saves before BANDIT-CODES (2026-11-11) stored bandit sites as building type plus `enemyCampModel`: refused. */
export const RETIRED_BANDIT_SITE_FORMAT =
  "This save uses the retired bandit camp format (enemyCampModel) and cannot be loaded; start a new island";

/** FISHER-BOAT trip (plan §2, owner answers 2026-11-11): in-place seconds before the rate. */
export const FISHER_BOAT_LIFT_SECONDS = 1.2;
export const FISHER_BOAT_LAUNCH_SECONDS = 3;
/** Net cast 2.4 s, soak 10 s, haul 4.8 s and stow 1.2 s at the net point. */
export const FISHER_BOAT_NET_SECONDS = 18.4;
export const FISHER_BOAT_BEACH_SECONDS = 2.4;
/** Rowing speed in tiles per second. */
export const FISHER_BOAT_ROW_SPEED = .9;
/** Fish hauled per trip; the fisher carries them together in one basket (owner answer 1). */
export const FISHER_BOAT_CATCH = 4;
/** Seconds before a blocked boat leg tries again. */
export const FISHER_BOAT_RETRY_SECONDS = 1;
/** Rowing routes kept per world (keyed by launch and net point). */
export const FISHER_BOAT_ROUTE_CACHE = 64;
/** Sample spacing along a straightened rowing leg. */
export const FISHER_BOAT_LEG_SAMPLE = .4;
/** Trip phases: walking legs, afloat legs (hidden rower, unreachable by raiders) and all of them. */
export const FISHER_BOAT_WALK_PHASES: ReadonlySet<string> =
  new Set(["fisherBoatFetch", "fisherBoatCarry", "fisherBoatWalk"]);
export const FISHER_BOAT_AFLOAT_PHASES: ReadonlySet<string> =
  new Set(["fisherBoatRowOut", "fisherBoatNet", "fisherBoatRowBack"]);
export const FISHER_BOAT_PHASES: ReadonlySet<string> = new Set([...FISHER_BOAT_WALK_PHASES,
  ...FISHER_BOAT_AFLOAT_PHASES, "fisherBoatLift", "fisherBoatLaunch", "fisherBoatBeach", "fisherBoatBlocked"]);

/** Map script UI reads on islands without a script (TRG9): shared empty answers, no allocation per tick. */
export const NO_SCRIPT_UI_EFFECTS: readonly never[] = Object.freeze([]);

/** Refusal of `confirmHomeClaim` for a declared home reward that is not pending (TRG7). */
export const HOME_CLAIM_NOT_PENDING = "This home reward is not waiting for confirmation";

/** NEW-ISLAND-FEEDBACK: construction refusal for a plot whose landmass has no storage access. */
export const NO_ISLAND_STORAGE_REASON = "Connect a storage on this island first";

/** MIL-SHIPS-SIM (2026-11-13): an idle own ship this close to a harbour berth counts as docked there (tiles). */
export const TROOP_SHIP_DOCKED_REACH = 24;
/** An anchored troop ship that is empty and boards nobody weighs anchor after this long (seconds). */
export const TROOP_SHIP_ANCHOR_LINGER_SECONDS = 120;
/** A troop ship that could not plan its course tries again after this long (seconds). */
export const TROOP_SHIP_RETRY_SECONDS = 1;
/**
 * Troop ship gangways meet the hull midships (share of the hull length, stern 0 to bow 1), clear of the stern
 * cabin and the bow (owner 2026-11-17: the gangway hid under the stern cabin roof).
 */
export const TROOP_GANGWAY_HULL_SPAN: readonly [number, number] = [.42, .6];
/** A troop ship stalled this close to its coast anchorage (tiles) eases onto it (the last tiles of a tight swing). */
export const TROOP_ANCHORAGE_SNAP = 2.5;
/** A troop ship this close to its anchorage pose (tiles, radians) lies there already. */
export const TROOP_GLIDE_POSE_TOLERANCE = .02;
/** Easing onto the anchorage pose (2026-11-17): tiles and radians per second (a slow drift under bare poles). */
export const TROOP_GLIDE_SPEED = .8;
export const TROOP_GLIDE_TURN_SPEED = .5;
/** The glide onto the anchorage lasts at least and at most this long (seconds). */
export const TROOP_GLIDE_MIN_SECONDS = 1;
export const TROOP_GLIDE_MAX_SECONDS = 5;
/** Below this speed (tiles per second) a troop ship under way counts as stalled. */
export const TROOP_ANCHORAGE_STALL_SPEED = .05;
/** Coast pickup (2026-11-17): the anchorage is searched this far from the soldier nearest the ship (tiles). */
export const TROOP_PICKUP_SEARCH_RADIUS = 24;
/** A pickup anchorage keeps this far from water another troop mission holds (tiles). */
export const TROOP_PICKUP_ANCHORAGE_SPACING = 8;
/** A clicked coast point: the landing beach is searched within this radius of it (tiles). */
export const TROOP_LANDING_PICK_RADIUS = 8;
/** A clicked point this close to an own harbour's access means its pier, not a beach (tiles). */
export const TROOP_HARBOUR_PICK_RADIUS = 4;
/**
 * A soldier waiting this close to an anchored ship's gangway foot walks up it (tiles). It covers a full deck
 * load's waiting places inland of the foot (2026-11-17: at 6 the outer soldiers were dropped from the boarding).
 */
export const TROOP_GANGWAY_REACH = 16;
/** Saved troop mission layout version (ShipTroopMission). */
export const SHIP_TROOP_MISSION_VERSION = 1;
/** Passenger reservation id of soldiers held by a troop mission (the same "held, no order" value as preparations). */
export const TROOP_MISSION_NAVAL_ORDER = 0;
/** Soldiers walking the anchored gangway at once, in file (the harbour passage's two). */
export const TROOP_GANGWAY_FILE = 2;
/** Visual only: anchored troop ships' gangway site ids (plus the ship id), apart from harbour docks and adventures. */
export const TROOP_GANGWAY_SITE_ID_OFFSET = 1_800_000;
/** The fleet's passenger list limit per ship (saved receipts hold at most this many). */
export const TROOP_SHIP_MAX_PASSENGERS = 40;
/** A field soldier ordered home to a storage passes through these phases until it is stored. */
export const TROOP_RETURNING_PHASES: readonly string[] = ["militaryField", "militarySiege", "militaryLeaving", "retire",
  "militaryMountedReturn", "enterRetire"];
/** Phases from which a soldier can be ordered aboard at a harbour (stored, or out in the field). */
export const TROOP_HARBOUR_BOARDING_PHASES: readonly string[] = ["militaryReserve",
  ...TROOP_RETURNING_PHASES.filter(phase => phase !== "enterRetire")];
/** Field soldiers walk to an anchored ship's gangway foot. */
export const TROOP_GANGWAY_BOARDING_PHASES: readonly string[] = ["militaryField", "militaryLeaving"];
/** Passengers on their way up an anchored ship's gangway (the file allows two at once). */
export const TROOP_GANGWAY_WALK_PHASES: ReadonlySet<string> =
  new Set(["navalToShip", "navalBoarding", "navalDeckWalk"]);
/**
 * Commander's horse aboard (2026-11-17): the deck places the horse takes on a troop ship, beside its rider's own.
 * Measured on the shared deck layout (every hull style): with one horse on deck at most 11 people keep a place,
 * so of the 16 places the horse takes 5 and the commander 6 in all.
 */
export const TROOP_SHIP_HORSE_DECK_PLACES = 5;
/** The led horse's middle keeps this far behind the commander holding its halter (tiles). */
export const TROOP_HORSE_LEAD_DISTANCE = 1.15;
/** The led horse never moves faster than this to keep up (tiles per second; a trot). */
export const TROOP_HORSE_LEAD_MAX_SPEED = 2.5;
/** The horse walks into its deck place, or turns there, at this pace (tiles per second). */
export const TROOP_HORSE_DECK_PACE = .9;
/** ...and turns to its standing heading at this rate (radians per second). */
export const TROOP_HORSE_TURN_SPEED = 2;
/** Rider phases (passenger of a troop ship) in which his horse is led or stands on deck. */
export const TROOP_HORSE_RIDER_PHASES: readonly string[] = ["navalToShip", "navalBoarding", "navalDeckWalk",
  "navalAboard", "navalDisembark", "navalLanding"];
/** Led-horse rider phases on the ground (the horse walks on the terrain); the others are on pier, gangway or deck. */
export const TROOP_HORSE_GROUND_PHASES: ReadonlySet<string> = new Set(["navalToShip", "navalLanding"]);
/** A troop ship lies still at a pier or an anchorage (the horse walks into its place); else it is under way. */
export const TROOP_SHIP_STATIONARY_PHASES: ReadonlySet<string> = new Set(["loading", "unloading"]);
/** A horse this close to its deck place (tiles) or its standing heading (radians) stands there. */
export const TROOP_HORSE_SETTLED = 1e-3;

/** Free cells kept between a new plot and other buildings by the plot pre-checks (room for roads and walkers). */
export const PLOT_SPACING = 1;
/** Cells around a pre-checked plot whose ground must be gentle too (the foundation apron reaches 3). */
export const PLOT_GROUND_MARGIN = 2;
/** Highest rise over a pre-checked plot and its margin (a cell is a cliff from a 1.5 rise). */
export const PLOT_GENTLE_RISE = 1;
/** Nearest road nodes looked at for a new building's flag ... */
export const ROAD_TARGET_NODES = 32;
/** ... of which this many, at least `ROAD_TARGET_SPACING` apart, are tried (not all on one road end). */
export const ROAD_TARGETS = 4;
export const ROAD_TARGET_SPACING = 2;

/** Shift queue (owner 2026-11-17): steps a soldier group can wait for after its current one. */
export const MILITARY_QUEUE_MAX_STEPS = 16;
/**
 * A queued group may leave one straggler per this many members (at least one) behind: once the rest finished the
 * current step and the stragglers took `MILITARY_QUEUE_STRAGGLER_SECONDS` longer, the next step starts for all.
 */
export const MILITARY_QUEUE_STRAGGLERS_PER = 10;
/** Seconds the finished part of a queued group waits for its stragglers before the next step starts. */
export const MILITARY_QUEUE_STRAGGLER_SECONDS = 8;
/** Ground modes a queued step may carry (attack-move, Alt move, Ctrl retreat). */
export const MILITARY_QUEUE_GROUND_MODES: ReadonlySet<string> = new Set(["attackMove", "move", "retreat"]);
/** Phases in which a queued soldier marches with its group (outside, or on its way out of a building). */
export const MILITARY_QUEUE_PHASES: ReadonlySet<string> = new Set(["militaryField", "militaryLeaving"]);

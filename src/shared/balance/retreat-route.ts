/**
 * Covered retreat routes and rally points (A14 plan §3.4, §4.2; lane A14-3). Distances in tiles, counts are
 * quotas (never wall-clock budgets) and the same on every commander level.
 */

/** Influence cells a route search may expand (plan §3.4: ≤ 64 per routed squad or soldier). */
export const ROUTE_EXPANSIONS = 64;
/** A route step's cost grows by this share per unit of enemy influence on the entered cell. */
export const ROUTE_EXPOSURE_WEIGHT = 2;
/** Turning points of a route handed out at a time (the next leg is routed again on arrival). */
export const ROUTE_WAYPOINTS = 3;
/** A leg counts as walked once its walker (a soldier or a squad's centre) is this near its end. */
export const WAYPOINT_REACH = 3;

/** Squads of one faction decision that may search a covered route (rolling by squad order). */
export const ROUTED_SQUADS_PER_DECISION = 4;
/** Routed soldiers' route searches per tick (the rest keep their leg until their next morale update). */
export const ROUT_SEARCHES_PER_TICK = 4;

/** A rally point (friendly hero, manned fort, steady reserve, own post) is chosen only within this distance. */
export const RALLY_RADIUS = 40;
/** A rally point must be at least this far from the routing soldier (else it is already there). */
export const RALLY_MIN_DISTANCE = 3;
/** A steady comrade standing this much farther from the enemy than a routing soldier counts as a reserve. */
export const RALLY_RESERVE_DEPTH = 6;
/** A routed soldier reaching its rally point gains this much morale, once per rout. */
export const RALLY_ARRIVAL_MORALE = 10;

/** A broken soldier whose way out stayed blocked for this many morale updates is cornered: it strikes back. */
export const CORNERED_UPDATES = 2;

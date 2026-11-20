import { MORALE_ROUT_DISTANCE } from "../../balance/morale";
import {
  CORNERED_UPDATES, RALLY_ARRIVAL_MORALE, RALLY_RESERVE_DEPTH, ROUT_SEARCHES_PER_TICK, WAYPOINT_REACH
} from "../../balance/retreat-route";
import { DMath } from "../../math/deterministic-math";
import { addInfluence, clearInfluence, createInfluenceMap } from "../military-influence-map";
import type { CombatCore, FieldMemory } from "../settlement-combat-core";
import type { SettlementActor, SettlementPoint } from "../settlement-types";
import { chooseRallyPoint } from "./commander-rally";
import { createRetreatRouter } from "./commander-retreat-route";
import type { MoraleSnapshot } from "./military-morale-snapshot";
import { isRetreatRouteTraceActive, traceRetreatRoute } from "./retreat-route-trace";

/** What the rout needs from the morale layer: clear ground, the retreat order, the clock, rally sources. */
export interface RoutRouteSources {
  isClear: (point: SettlementPoint) => boolean;
  /** Issues a `retreat` march for `ids` of `faction`; returns the ids that took it. */
  retreat: (ids: readonly number[], point: SettlementPoint, faction: number) => readonly number[];
  tick: () => number;
  /** A clear point `distance` tiles from `from` away from `enemy` along the least crowded way (the fallback). */
  awayPoint: (from: SettlementPoint, enemy: SettlementPoint, distance: number) => SettlementPoint | undefined;
  /** This tick's friendly hero `[x, z]` of `faction` and manned forts `[x, z, …]` of `faction` (rally kinds). */
  heroOf: (faction: number) => readonly number[];
  fortsOf: (faction: number) => readonly number[];
}

/** The routing soldier's nearest known enemy within the cornered range (the sweep's finding; NaN: none). */
export interface RoutThreat {
  x: number;
  z: number;
}

const squared = (dx: number, dz: number) => dx * dx + dz * dz;

/**
 * Covered rout (A14 plan §4.2, lane A14-3): a broken soldier runs to a rally point (friendly hero, manned fort,
 * steady reserve, its own post; else straight away from the enemy) along a covered route over its faction's
 * knowledge (own soldiers and the enemies it knows now), one leg at a time: each leg is routed again from where
 * the soldier stands when it is nearly walked. Reaching the rally point gives `RALLY_ARRIVAL_MORALE` once. A way
 * out blocked by an enemy ahead (or no way at all) for `CORNERED_UPDATES` updates corners it (it strikes back).
 * At most `ROUT_SEARCHES_PER_TICK` searches per tick; the rest keep their leg until their next update.
 */
export const createRoutRoute = (core: CombatCore, snapshot: MoraleSnapshot, sources: RoutRouteSources) => {
  const { cellsX, cellsZ } = core.context.options.world;
  const map = createInfluenceMap(cellsX, cellsZ);
  const router = createRetreatRouter(map);
  const reserve: number[] = [], home: number[] = [], kinds: (readonly number[])[] = [];
  let searchTick = -1, searches = 0, mapTick = -1, mapFaction = -1;

  const addKnown = (body: SettlementActor, index: number) => {
    addInfluence(map, snapshot.factionAt(index), body, snapshot.strengthAt(index));
  };
  /** The faction's influence map of this tick (built on its first search). */
  const prepareMap = (faction: number, tick: number) => {
    if (mapTick === tick && mapFaction === faction) return;
    mapTick = tick;
    mapFaction = faction;
    clearInfluence(map);
    snapshot.forEachKnown(faction, addKnown);
  };
  const takeSearch = (tick: number) => {
    if (searchTick !== tick) { searchTick = tick; searches = 0; }
    if (searches >= ROUT_SEARCHES_PER_TICK) return false;
    searches++;
    return true;
  };

  /** Steady comrades standing `RALLY_RESERVE_DEPTH` farther from the enemy than the soldier. */
  const collectReserve = (body: SettlementActor, faction: number, enemy: SettlementPoint) => {
    reserve.length = 0;
    const depth = DMath.hypot(body.x - enemy.x, body.z - enemy.z) + RALLY_RESERVE_DEPTH;
    const entries = snapshot.entries();
    entries.forEach((other, index) => {
      if (snapshot.indexOf(other.uid) !== index || snapshot.factionAt(index) !== faction) return;
      if (!snapshot.isSteady(index) || squared(other.x - enemy.x, other.z - enemy.z) < depth * depth) return;
      reserve.push(other.x, other.z);
    });
  };
  /** Plan §4.2 rally point, else a point `MORALE_ROUT_DISTANCE` straight away from the enemy. */
  const goalOf = (body: SettlementActor, faction: number, memory: FieldMemory, enemy: SettlementPoint) => {
    collectReserve(body, faction, enemy);
    home.length = 0;
    if (memory.anchor) home.push(memory.anchor.x, memory.anchor.z);
    kinds.length = 0;
    kinds.push(sources.heroOf(faction), sources.fortsOf(faction), reserve, home);
    const rally = chooseRallyPoint(body, enemy, kinds);
    if (rally && sources.isClear(rally)) return rally;
    return sources.awayPoint(body, enemy, MORALE_ROUT_DISTANCE);
  };

  /** The next leg towards `goal` (undefined: no way out); traced for the fixtures. */
  const legTowards = (body: SettlementActor, faction: number, goal: SettlementPoint, tick: number) => {
    prepareMap(faction, tick);
    const route = router.route(faction, body, goal, sources.isClear);
    if (isRetreatRouteTraceActive() && !route.blocked)
      traceRetreatRoute({ exposure: route.exposure, expansions: route.expansions, faction, kind: "rout",
        reached: route.reached, straightExposure: route.straightExposure, uid: body.uid });
    return route.blocked ? undefined : route.waypoints[0];
  };
  /** Sends the soldier along its leg and keeps the rout's memory on its fresh field memory. */
  const send = (body: SettlementActor, faction: number, leg: SettlementPoint, goal: SettlementPoint,
    blocked: number) => {
    const ordered = sources.retreat([body.uid], leg, faction).length;
    const memory = core.memoryOf(body.uid);
    memory.rally = { x: goal.x, z: goal.z };
    memory.blocked = blocked || undefined;
    return ordered;
  };

  /** A soldier breaks: it routs towards its rally point (the straight way when this tick's searches are spent). */
  const begin = (body: SettlementActor, faction: number, memory: FieldMemory, enemy: SettlementPoint) => {
    const goal = goalOf(body, faction, memory, enemy);
    if (!goal) return 0;
    const tick = sources.tick();
    if (!takeSearch(tick)) return send(body, faction, goal, goal, 0);
    const leg = legTowards(body, faction, goal, tick);
    if (leg) return send(body, faction, leg, goal, 0);
    memory.rally = { x: goal.x, z: goal.z };
    memory.blocked = 1;
    return 0;
  };

  /** An enemy within the cornered range stands between the soldier and where it runs to. */
  const isAhead = (body: SettlementActor, threat: RoutThreat, towards: SettlementPoint) =>
    !Number.isNaN(threat.x) &&
    (threat.x - body.x) * (towards.x - body.x) + (threat.z - body.z) * (towards.z - body.z) > 0;

  /** The rout goes on: arrival, the cornered count, and the next leg once the current one is nearly walked. */
  const follow = (body: SettlementActor, faction: number, memory: FieldMemory, threat: RoutThreat,
    destination: SettlementPoint | undefined) => {
    const rally = memory.rally;
    if (!rally) return 0;
    if (squared(rally.x - body.x, rally.z - body.z) <= WAYPOINT_REACH * WAYPOINT_REACH) {
      memory.morale = Math.min(100, (memory.morale ?? 0) + RALLY_ARRIVAL_MORALE);
      memory.rally = undefined;
      memory.blocked = undefined;
      return 0;
    }
    const ahead = isAhead(body, threat, destination ?? rally);
    const walking = destination !== undefined &&
      squared(destination.x - body.x, destination.z - body.z) > WAYPOINT_REACH * WAYPOINT_REACH;
    const blocked = ahead ? Math.min(CORNERED_UPDATES, (memory.blocked ?? 0) + 1) : 0;
    memory.blocked = blocked || undefined;
    const tick = sources.tick();
    if ((walking && !ahead) || !takeSearch(tick)) return 0;
    const leg = legTowards(body, faction, rally, tick);
    if (!leg) {
      memory.blocked = Math.min(CORNERED_UPDATES, (memory.blocked ?? 0) + (ahead ? 0 : 1));
      return 0;
    }
    if (destination && squared(leg.x - destination.x, leg.z - destination.z) < 1) return 0;
    return send(body, faction, leg, rally, blocked);
  };

  /** A rallied soldier's rout is over. */
  const end = (memory: FieldMemory) => {
    memory.rally = undefined;
    memory.blocked = undefined;
  };
  return { begin, end, follow };
};

export type RoutRoute = ReturnType<typeof createRoutRoute>;

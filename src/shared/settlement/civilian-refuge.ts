import { DMath } from "../math/deterministic-math";
import { CIVILIAN_THREAT_RADIUS } from "./military-civilian-safety";
import { isNavigationClear } from "./settlement-navigation";
import { groundPath, setActorPath } from "./settlement-paths";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "./settlement-types";

/** A fleeing civilian with no safe storage runs this far (tiles) straight away from the nearest raider. */
const ESCAPE_DISTANCE = 10;
/** Escape headings tried in order: straight away, then turned this far (radians) either side. */
const ESCAPE_TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2] as const;
/** A refuge route passing this close (tiles) to a raider is not taken. */
const ROUTE_CLEARANCE = 3;
/** Seconds a waiting refugee lets pass before it searches for a safe storage again. */
const REFUGE_RETRY_SECONDS = 4;
/** At most this many of the nearest safe storages are searched for a route per attempt. */
const REFUGE_CANDIDATES = 2;
/** Seconds a refugee waits when this tick's long route searches are used up. */
const REFUGE_BUSY_SECONDS = .25;
/** The phase of a civilian running away from raiders when no storage is safe. */
export const CIVILIAN_ESCAPE_PHASE = "civilianEscape";

const distanceTo = (actor: SettlementActor, store: SettlementBuilding) =>
  DMath.hypot(store.access.x - actor.x, store.access.z - actor.z);

/** The straight line to the point passes close to a raider (a cheap filter before any search). */
const lineNearRaider = (context: SettlementContext, actor: SettlementActor, point: SettlementPoint) => {
  const span = DMath.hypot(point.x - actor.x, point.z - actor.z), steps = Math.max(1, Math.ceil(span));
  for (let step = 1; step <= steps; step++) {
    const share = step / steps;
    const sample = { x: actor.x + (point.x - actor.x) * share, z: actor.z + (point.z - actor.z) * share };
    if (context.civilianThreat?.enemyWithin(sample, ROUTE_CLEARANCE)) return true;
  }
  return false;
};

/** Walks to one of the nearest storages, of `safe`, that a route reaches clear of the raiders. */
const runToSafeStorage = (context: SettlementContext, actor: SettlementActor, safe: SettlementBuilding[]) => {
  safe.sort((a, b) => distanceTo(actor, a) - distanceTo(actor, b) || a.uid - b.uid);
  const candidates = safe.filter(store => !lineNearRaider(context, actor, store.access)).slice(0, REFUGE_CANDIDATES);
  for (const store of candidates) {
    const path = groundPath(context, actor, store.access);
    if (!path || path.some(point => context.civilianThreat?.enemyWithin(point, ROUTE_CLEARANCE))) continue;
    Object.assign(actor, { building: store.uid, home: store.uid, stockBuilding: undefined, stockContact: undefined });
    setActorPath(actor, path, "retire");
    return true;
  }
  return false;
};

/** Runs straight away from the nearest raider (or slanted, when the straight way is blocked). */
const escapeFromRaider = (context: SettlementContext, actor: SettlementActor) => {
  const raider = context.civilianThreat?.nearestEnemy(actor, CIVILIAN_THREAT_RADIUS);
  if (!raider) return false;
  const away = DMath.atan2(actor.x - raider.x, actor.z - raider.z);
  for (const turn of ESCAPE_TURNS) {
    const heading = away + turn;
    const goal = { x: actor.x + DMath.sin(heading) * ESCAPE_DISTANCE,
      z: actor.z + DMath.cos(heading) * ESCAPE_DISTANCE };
    if (!isNavigationClear(context, goal)) continue;
    const path = groundPath(context, actor, goal);
    if (!path) continue;
    setActorPath(actor, path, CIVILIAN_ESCAPE_PHASE);
    return true;
  }
  return false;
};

/**
 * Where a displaced or fleeing person goes while raiders hold storage doors (MIL-ASSAULT 2026-11-09):
 * one still within a raider's reach first runs straight away from it; out of reach it heads for the
 * nearest storage that is a safe refuge (door clear, not besieged, walls standing: BD1) (a few long route searches per tick on the whole island), or,
 * with none reachable, waits where it stands and looks again every few seconds (half a second while
 * a raider is near). False while no computer soldier is in the field (the ordinary return applies).
 */
export const planCivilianRefuge = (
  context: SettlementContext, actor: SettlementActor, stores: readonly SettlementBuilding[], dt: number
) => {
  const threat = context.civilianThreat;
  if (!threat?.active()) return false;
  const safe = stores.filter(store => !threat.unsafeRefuge(store));
  if (actor.timer > 0) { actor.timer = Math.max(0, actor.timer - dt); return true; }
  const threatened = threat.threatens(actor);
  if (!threatened && !threat.takeRefugeSearch()) { actor.timer = REFUGE_BUSY_SECONDS; return true; }
  if (!threatened && runToSafeStorage(context, actor, safe)) return true;
  if (threatened && escapeFromRaider(context, actor)) return true;
  actor.timer = threatened ? REFUGE_BUSY_SECONDS * 2 : REFUGE_RETRY_SECONDS;
  return true;
};

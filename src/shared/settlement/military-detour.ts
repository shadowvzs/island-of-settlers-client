import { DMath } from "../math/deterministic-math";
import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import type { MilitarySpatialGrid } from "./military-spatial-grid";
import { findGroundPath, isMountedNavigationClear } from "./settlement-navigation";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Detours of held-up soldiers (docs/archive/dated/military-motion-2026-10-13.md). Local avoidance bends a soldier
 * round bodies, but a path planned over open ground can lead straight into a line of soldiers
 * standing still (archers shooting, a waiting queue): the soldier then presses against them for
 * ever. A soldier held within half a tile for 1.5 s plans a short way round the bodies standing near
 * it, rejoining its path a few tiles further on. Searches are capped per tick; the holds are saved.
 */
interface Hold { x: number; z: number; seconds: number; detours: number }
export type MilitaryDetourSave = SavedEntries<Hold>;

/** Held within this distance (tiles) for this long (seconds) before a detour is planned. */
const HOLD_RADIUS = .5;
const HOLD_SECONDS = 1.5;
/** The detour rejoins the path about this far ahead (tiles), and treats standing bodies this close. */
const REJOIN_DISTANCE = 5;
const BODY_RADIUS = REJOIN_DISTANCE + 1;
/** Only a soldier with at least this much way left plans one (not one a step from its foe or place). */
const MINIMUM_WAY = 1.2;
/** Search budget of one detour, and detours planned per tick across all soldiers. */
const DETOUR_VISITS = 600;
const DETOURS_PER_TICK = 1;
const BODY_PAD = .05;
/** Cell size (tiles) of the map of standing bodies around the held soldier. */
const CROWD_CELL = .25;
const CROWD_SIDE = Math.ceil(BODY_RADIUS * 2 / CROWD_CELL);

/**
 * Index of the first path point at least `REJOIN_DISTANCE` along the path (else the last), or -1
 * when less than `MINIMUM_WAY` is left.
 */
const rejoinIndex = (actor: SettlementActor) => {
  let walked = 0, previous: SettlementPoint = actor;
  for (let index = actor.pathIndex; index < actor.path.length; index++) {
    const point = actor.path[index]!;
    walked += DMath.hypot(point.x - previous.x, point.z - previous.z);
    if (walked >= REJOIN_DISTANCE) return index;
    previous = point;
  }
  return walked >= MINIMUM_WAY ? actor.path.length - 1 : -1;
};

export const createMilitaryDetours = (context: SettlementContext, grid: MilitarySpatialGrid<SettlementActor>,
  isStanding: (body: SettlementActor) => boolean) => {
  const holds = new Map<number, Hold>();
  let budget = DETOURS_PER_TICK;
  /** Cells covered by standing bodies around the held soldier (a search samples it thousands of times). */
  const crowd = new Uint8Array(CROWD_SIDE * CROWD_SIDE);
  let originX = 0, originZ = 0;
  /** Marks the cells a standing body covers; a body the soldier already presses against is left out. */
  const markBody = (actor: SettlementActor, body: SettlementActor) => {
    const clearance = actorSeparation(actor, body) + BODY_PAD;
    if (DMath.hypot(actor.x - body.x, actor.z - body.z) < clearance) return;
    const first = (value: number, origin: number) => Math.max(0, Math.floor((value - clearance - origin) / CROWD_CELL));
    const last = (value: number, origin: number) =>
      Math.min(CROWD_SIDE - 1, Math.floor((value + clearance - origin) / CROWD_CELL));
    for (let row = first(body.z, originZ); row <= last(body.z, originZ); row++)
      for (let column = first(body.x, originX); column <= last(body.x, originX); column++) {
        const x = originX + (column + .5) * CROWD_CELL, z = originZ + (row + .5) * CROWD_CELL;
        if (DMath.hypot(x - body.x, z - body.z) < clearance) crowd[row * CROWD_SIDE + column] = 1;
      }
  };
  const isCrowded = (point: SettlementPoint) => {
    const column = Math.floor((point.x - originX) / CROWD_CELL), row = Math.floor((point.z - originZ) / CROWD_CELL);
    return column >= 0 && row >= 0 && column < CROWD_SIDE && row < CROWD_SIDE && crowd[row * CROWD_SIDE + column] === 1;
  };
  /** Standing bodies near the soldier block the search (riders also need a horse's room). */
  const crowdBlocker = (actor: SettlementActor) => {
    crowd.fill(0); originX = actor.x - BODY_RADIUS; originZ = actor.z - BODY_RADIUS;
    grid.forEachWithin(actor.x, actor.z, BODY_RADIUS, body => body !== actor && body.visible && isStanding(body),
      body => markBody(actor, body));
    return (point: SettlementPoint) => isCrowded(point) || (actor.mounted === true && !isMountedNavigationClear(context, point));
  };
  const planDetour = (actor: SettlementActor) => {
    const rejoin = rejoinIndex(actor), goal = actor.path[rejoin];
    if (!goal) return false;
    const detour = findGroundPath(context, actor, goal, crowdBlocker(actor), undefined, .5, DETOUR_VISITS);
    if (!detour) return true;
    actor.path = [...detour, ...actor.path.slice(rejoin + 1)];
    actor.pathIndex = 0;
    return true;
  };
  return {
    beginTick: () => { budget = DETOURS_PER_TICK; },
    /** After a soldier's step (or wait): plans a detour once it has been held long enough. */
    watch: (actor: SettlementActor, dt: number) => {
      const hold = holds.get(actor.uid);
      if (!hold) { holds.set(actor.uid, { detours: 0, seconds: 0, x: actor.x, z: actor.z }); return; }
      if (DMath.hypot(actor.x - hold.x, actor.z - hold.z) > HOLD_RADIUS) {
        hold.x = actor.x; hold.z = actor.z; hold.seconds = 0; hold.detours = 0; return;
      }
      hold.seconds += dt;
      if (hold.seconds < HOLD_SECONDS * (hold.detours + 1) || budget <= 0 || actor.pathIndex >= actor.path.length)
        return;
      hold.detours++;
      if (planDetour(actor)) budget--;
    },
    /** Seconds the soldier has been held within half a tile (its impatience). */
    heldSeconds: (uid: number) => holds.get(uid)?.seconds ?? 0,
    forget: (uid: number) => holds.delete(uid),
    clear: () => holds.clear(),
    save: (): MilitaryDetourSave => saveEntries(holds),
    restore: (saved: MilitaryDetourSave | undefined) =>
      restoreEntries(holds, saved)
  };
};

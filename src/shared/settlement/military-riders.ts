import { DMath } from "../math/deterministic-math";
import type { MilitaryCombatant } from "./military-combat-rules";
import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import type { MilitaryStance } from "./military-targeting";
import type { TransportHorseFrame } from "./settlement-horses";
import type { SettlementSoldier } from "./settlement-military";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { groundPath } from "./settlement-paths";
import { forEachNearbyTrafficActor } from "./settlement-person-index";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** A rider this close to the besieged door's access decides whether to dismount. */
const DISMOUNT_RANGE = 4;
/** A dismounted rider idle this long walks back to its horse and mounts (owner decision 2026-10-13). */
const REMOUNT_IDLE_SECONDS = 3;
/** A rider this close to its mounting place beside the waiting horse gets on. */
const MOUNT_REACH = .3;
/** The rider steps this far to the side of its horse when it gets down. */
const DISMOUNT_STEP = .7;
/** Distances out of the door (along its lane) and sideways tried for the riders' siege front. */
const FRONT_OUTSIDE = [3.2, 4, 5, 6, 7];
const FRONT_SIDE = [0, 1.2, -1.2, 2.4, -2.4];
const FRONT_ANGLES = 16;

/** Idle seconds of dismounted riders and the mounting places of riders walking back to their horses. */
export interface MilitaryRidersSave { idle: SavedEntries<number>; returning: SavedEntries<SettlementPoint> }

interface RiderDeps {
  actorById: (id: number) => SettlementActor | undefined;
  soldiers: ReadonlyMap<number, SettlementSoldier>;
  hasDoorSlot: (uid: number, body: SettlementActor) => boolean;
  plan: (actor: SettlementActor, state: MilitaryCombatant, point: SettlementPoint) => void;
  stand: (actor: SettlementActor) => void;
  walk: (actor: SettlementActor, dt: number) => void;
}

/**
 * Cavalry at a siege (owner decision 2026-10-13): riders hunt the enemy's reinforcements (the
 * field behaviour does that); with none left, a rider reaching the door gets down and fights as
 * heavy infantry only when a fighting place at the door is free, its horse waiting beside it.
 * A dismounted rider idle for 3 s, or given another order, walks back to its horse and mounts.
 */
export const createMilitaryRiders = (context: SettlementContext, deps: RiderDeps) => {
  /** Seconds each dismounted rider has stood idle. */
  const idle = new Map<number, number>();
  const returning = new Map<number, SettlementPoint>();
  const buildingOf = (uid: number | undefined) =>
    uid === undefined ? undefined : context.buildings.find(entry => entry.uid === uid);
  /** Open, mounted-clear ground in front of a besieged door where riders gather. */
  const siegeFront = (site: SettlementBuilding) => {
    const dx = site.access.x - site.workerApproach.x, dz = site.access.z - site.workerApproach.z;
    const length = DMath.hypot(dx, dz) || 1, forward = { x: dx / length, z: dz / length };
    for (const outside of FRONT_OUTSIDE) for (const side of FRONT_SIDE) {
      const point = { x: site.access.x + forward.x * outside - forward.z * side,
        z: site.access.z + forward.z * outside + forward.x * side };
      if (isMountedNavigationClear(context, point) && groundPath(context, site.access, point)) return point;
    }
    // A door facing the shore or a cliff: the nearest open ground around it instead.
    for (const radius of FRONT_OUTSIDE) for (let step = 0; step < FRONT_ANGLES; step++) {
      const angle = step * Math.PI * 2 / FRONT_ANGLES;
      const point = { x: site.access.x + DMath.cos(angle) * radius, z: site.access.z + DMath.sin(angle) * radius };
      if (isMountedNavigationClear(context, point) && groundPath(context, site.access, point)) return point;
    }
    return undefined;
  };
  /** Where the rider stands to get on or off: beside the horse's left flank, else its right. */
  const horseSide = (horse: SettlementActor) => [1, -1].map(side => ({
    x: horse.x - DMath.cos(horse.yaw) * DISMOUNT_STEP * side, z: horse.z + DMath.sin(horse.yaw) * DISMOUNT_STEP * side
  })).find(point => isNavigationClear(context, point)) ?? horse;
  const dismount = (actor: SettlementActor, state: MilitaryCombatant) => {
    const horse = deps.actorById(state.mount ?? NaN);
    if (!horse) return;
    Object.assign(horse, { action: "idle", x: actor.x, y: actor.y, yaw: actor.yaw, z: actor.z });
    actor.mounted = false; state.dismounted = true;
    deps.stand(actor);
    Object.assign(actor, horseSide(horse));
  };
  const mount = (actor: SettlementActor, state: MilitaryCombatant, horse: SettlementActor) => {
    Object.assign(actor, { mounted: true, x: horse.x, y: horse.y, yaw: horse.yaw, z: horse.z });
    state.dismounted = undefined; idle.delete(actor.uid); returning.delete(actor.uid);
    deps.stand(actor);
  };
  /** A mounted rider of a siege with nobody to hunt: rides to the door, gets down if a place is free. */
  const approachDoor = (actor: SettlementActor, state: MilitaryCombatant, dt: number) => {
    const site = buildingOf(state.siege);
    if (!actor.mounted || !site) return false;
    if (DMath.hypot(site.access.x - actor.x, site.access.z - actor.z) > DISMOUNT_RANGE + .05) {
      const front = siegeFront(site);
      if (!front) return false;
      // A shore or cliff may keep the horse outside the usual four-tile band. Once at
      // its nearest reachable front, continue to the free door place on foot.
      if (DMath.hypot(actor.x - front.x, actor.z - front.z) < .3 && deps.hasDoorSlot(site.uid, actor)) {
        dismount(actor, state); return true;
      }
      deps.plan(actor, state, front); deps.walk(actor, dt);
      return true;
    }
    if (deps.hasDoorSlot(site.uid, actor)) dismount(actor, state);
    else deps.stand(actor);
    return true;
  };
  /** Returns true while the dismounted rider walks back to its horse (it then mounts). */
  const updateDismounted = (actor: SettlementActor, state: MilitaryCombatant, stance: MilitaryStance, dt: number) => {
    const standing = actor.action === "idle" && actor.pathIndex >= actor.path.length &&
      state.target === undefined && state.pendingTarget === undefined;
    const seconds = standing ? (idle.get(actor.uid) ?? 0) + dt : 0;
    idle.set(actor.uid, seconds);
    if (stance === "siege" && seconds < REMOUNT_IDLE_SECONDS && !returning.has(actor.uid)) return false;
    const horse = deps.actorById(state.mount ?? NaN);
    if (!horse) { state.dismounted = undefined; return false; }
    const side = [1, -1].map(sign => ({
      x: horse.x - DMath.cos(horse.yaw) * DISMOUNT_STEP * sign,
      z: horse.z + DMath.sin(horse.yaw) * DISMOUNT_STEP * sign
    })).find(point => isNavigationClear(context, point) && !forEachNearbyTrafficActor(context, point, 2.2,
      other => other !== actor && other !== horse && other.visible &&
        DMath.hypot(other.x - point.x, other.z - point.z) < actorSeparation(actor, other)));
    if (!side) { deps.stand(actor); return true; }
    const previous = returning.get(actor.uid);
    if (!previous || DMath.hypot(previous.x - side.x, previous.z - side.z) > .01) {
      returning.set(actor.uid, side); deps.stand(actor); state.routeAge = 0;
    }
    if (DMath.hypot(side.x - actor.x, side.z - actor.z) <= MOUNT_REACH) { mount(actor, state, horse); return true; }
    deps.plan(actor, state, side); deps.walk(actor, dt);
    return true;
  };
  /** Frames of the horses waiting beside their dismounted riders, drawn like led horses at rest. */
  const waitingHorses = (): TransportHorseFrame[] => {
    const frames: TransportHorseFrame[] = [];
    for (const soldier of deps.soldiers.values()) {
      const horse = soldier.combat?.dismounted ? deps.actorById(soldier.combat.mount ?? NaN) : undefined;
      if (horse) frames.push({ heading: horse.yaw, id: horse.uid, moving: horse.action === "walk", walkTime: horse.animationTime,
        visible: true, x: horse.x, y: horse.y, z: horse.z });
    }
    return frames;
  };
  /** Puts a dismounted rider back on its horse where the horse waits (sent home from the door). */
  const mountNow = (actor: SettlementActor, state: MilitaryCombatant) => {
    const horse = deps.actorById(state.mount ?? NaN);
    if (horse) mount(actor, state, horse);
  };
  return { approachDoor, clear: () => { idle.clear(); returning.clear(); },
    forget: (id: number) => { idle.delete(id); returning.delete(id); }, mountNow, siegeFront,
    updateDismounted, waitingHorses,
    save: (): MilitaryRidersSave => ({ idle: saveEntries(idle), returning: saveEntries(returning) }),
    restore: (saved: Partial<MilitaryRidersSave> | undefined) => {
      restoreEntries(idle, saved?.idle); restoreEntries(returning, saved?.returning);
    } };
};

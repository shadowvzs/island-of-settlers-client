import { DMath } from "../math/deterministic-math";
import { addGood } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { addIdleSettlers, retirePerson } from "./settlement-population";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * An outing from a storage (BD2 ruin clearing, EAI2d wall repair): the person leaves its storage like any worker
 * (`assigned`), walks to a work point, works there, and walks back into that storage (`retire`, `enterRetire`) to
 * rest as an idle settler again. Wares it carries ride in `demolitionCargo`, so a person put to flight or without a
 * way home still delivers them wherever the demolition return takes it.
 */
export const OUTING_OUTBOUND_PHASE = "assigned";
const RETURN_PHASE = "retire";
const ENTER_PHASE = "enterRetire";
/** Seconds a person may stand still on its way out before it gives the work up (owner gate point 4). */
const OUTING_STALL_SECONDS = 10;

/** Whether the person walks back into its storage. */
export const returnsFromOuting = (actor: SettlementActor) => actor.phase === RETURN_PHASE ||
  actor.phase === ENTER_PHASE;

/** Sends a settler of `storage` out along `path` (from the storage's access). */
export const startOuting = (actor: SettlementActor, storage: SettlementBuilding, path: readonly SettlementPoint[]) => {
  setActorPath(actor, [...exitPath(storage), ...path], OUTING_OUTBOUND_PHASE);
};

/** Inside its storage: any cargo joins the stock and the person is an idle settler there again. */
const rest = (context: SettlementContext, actor: SettlementActor, home: SettlementBuilding) => {
  for (const [ware, count] of Object.entries(actor.demolitionCargo ?? {}))
    if (count > 0) addGood(home.inventory, ware, count);
  Object.assign(actor, { action: "idle", building: home.uid, demolitionCargo: undefined, path: [], pathIndex: 0,
    ruinClearing: undefined, visible: false, wallRepair: undefined });
  retirePerson(context, actor);
  addIdleSettlers(context, home);
};

/** The way home: still inside, it simply rests again; without a way the demolition return takes over. */
export const walkHomeFromOuting = (context: SettlementContext, actor: SettlementActor) => {
  const home = getBuilding(context, actor.home);
  if (home?.construction === 1 && !actor.visible) {
    rest(context, actor, home);
    return;
  }
  const path = home?.construction === 1 ? groundPath(context, actor, home.access) : null;
  if (path) {
    actor.timer = 0;
    setActorPath(actor, path, RETURN_PHASE);
    return;
  }
  Object.assign(actor, { action: "idle", demolitionReturning: true, path: [], pathIndex: 0,
    phase: "demolitionBlocked", ruinClearing: undefined, timer: 0, wallRepair: undefined });
};

/** Walks back and enters the storage (call while `returnsFromOuting`). */
export const returnFromOuting = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  const home = getBuilding(context, actor.home);
  if (home?.construction !== 1) {
    walkHomeFromOuting(context, actor);
    return;
  }
  if (!moveActor(context, actor, dt)) return;
  if (actor.phase === ENTER_PHASE) rest(context, actor, home);
  else if (canEnterDoor(context, actor, home)) setActorPath(actor, entrancePath(home), ENTER_PHASE);
};

/**
 * One step on the way out. On arrival the person faces `face` and starts working in `workPhase`. Returns true when
 * it stood still for `OUTING_STALL_SECONDS` (the caller gives the work up).
 */
export const walkOutbound = (context: SettlementContext, actor: SettlementActor, dt: number, workPhase: string,
  face: SettlementPoint) => {
  const { x, z } = actor;
  if (moveActor(context, actor, dt)) {
    Object.assign(actor, { action: "work", path: [], pathIndex: 0, phase: workPhase, timer: 0,
      yaw: DMath.atan2(face.x - actor.x, face.z - actor.z) });
    return false;
  }
  actor.timer = actor.x === x && actor.z === z ? actor.timer + dt : 0;
  return actor.timer >= OUTING_STALL_SECONDS;
};

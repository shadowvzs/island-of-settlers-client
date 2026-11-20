import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { shootAnimal } from "../script-world/nature/nature-events";
import { HUNT_REPLAN_SECONDS } from "./constants";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import type { ResourceTarget, SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

export const HUNT_DRAW_SECONDS = 1.6;
export const HUNT_RELEASE_PROGRESS = .75;
/** Aim time before the shot is released; kept as a shared boundary for the fixed tick and future event timer. */
export const HUNT_ARROW_RELEASE_SECONDS = HUNT_DRAW_SECONDS * (1 - HUNT_RELEASE_PROGRESS);
export const huntArrowCanRelease = (remaining: number) => remaining <= HUNT_ARROW_RELEASE_SECONDS;
const HUNT_RANGE = 5;
const HUNT_DISTANCE = 4;

/** Stand off from the prey instead of walking into its body. Closest reachable side wins. */
export const huntingApproaches = (target: SettlementPoint, from: SettlementPoint) => {
  const angle = DMath.atan2(from.z - target.z, from.x - target.x);
  return [0, .5, -.5, 1, -1, Math.PI].map(offset => ({
    x: target.x + DMath.cos(angle + offset) * HUNT_DISTANCE,
    z: target.z + DMath.sin(angle + offset) * HUNT_DISTANCE
  }));
};

const pursue = (context: SettlementContext, actor: SettlementActor, target: ResourceTarget, collect: boolean) => {
  const approaches = collect ? [target] : huntingApproaches(target, actor);
  for (const point of approaches) {
    const path = groundPath(context, actor, point);
    if (!path) continue;
    setActorPath(actor, path, collect ? "huntCollect" : "huntChase");
    actor.timer = 1;
    if (!collect) actor.huntReplan = HUNT_REPLAN_SECONDS;
    context.options.onWorkerPhase?.(actor);
    return true;
  }
  actor.phase = "huntWait"; actor.action = "idle"; actor.timer = 1;
  context.options.onWorkerPhase?.(actor);
  return false;
};

/** The shared wait/approach boundary decision: collect, chase, keep waiting or draw the bow. */
interface HuntPrey { x: number; z: number; dead: boolean; fleeing: boolean }
const finishHuntWait = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding,
  prey: HuntPrey, distance: number
) => {
  if (prey.dead) { pursue(context, actor, actor.target!, true); building.status = "Collecting prey"; return true; }
  if (distance > HUNT_RANGE || distance < 2) {
    pursue(context, actor, actor.target!, false); building.status = "Following prey"; return true;
  }
  actor.action = "idle";
  if (prey.fleeing) {
    actor.phase = "huntWait"; actor.timer = .3;
    context.options.onWorkerPhase?.(actor);
    return true;
  }
  actor.phase = "huntAim"; actor.action = "work"; actor.timer = HUNT_DRAW_SECONDS;
  actor.yaw = DMath.atan2(prey.x - actor.x, prey.z - actor.z);
  context.options.onWorkerPhase?.(actor);
  building.status = "Hunting";
  return true;
};

/** Physical approach, two timed shots, a live chase, then collection of the fallen animal. */
export const updateHunter = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding,
  dt: number, finish: () => void) => {
  if (building.typeId !== 22 || !actor.target || !context.options.getHuntTarget ||
    !context.options.hitHuntTarget || !(actor.phase.startsWith("hunt") ||
      actor.phase === "outbound" || actor.phase === "work")) return false;
  const prey = context.options.getHuntTarget(actor.target.id);
  if (!prey) { actor.huntArrow = undefined; actor.huntReplan = undefined; finish(); return true; }
  Object.assign(actor.target, { x: prey.x, z: prey.z });
  const distance = DMath.hypot(actor.x - prey.x, actor.z - prey.z);
  building.working = true;
  if (actor.phase === "outbound") {
    if (!moveActor(context, actor, dt)) return true;
    actor.phase = "huntWait"; actor.timer = 0;
  }
  if (actor.phase === "huntFlight") {
    actor.timer -= dt;
    if (actor.timer > 0) return true;
    if (!prey.dead) shootAnimal(context, actor, actor.target.id);
    actor.huntArrow = undefined;
    actor.phase = "huntWait"; actor.action = "idle"; actor.timer = .3;
    context.options.onWorkerPhase?.(actor);
    return true;
  }
  if (actor.phase === "huntAim") {
    actor.yaw = DMath.atan2(prey.x - actor.x, prey.z - actor.z);
    if (prey.fleeing || prey.dead || distance > HUNT_RANGE || distance < 2) {
      actor.phase = "huntWait"; actor.action = "idle"; actor.timer = 0;
      context.options.onWorkerPhase?.(actor);
      return true;
    }
    actor.timer -= dt;
    if (!huntArrowCanRelease(actor.timer)) return true;
    const height = sampleSmooth(context.options.world, context.options.world.heights, prey.x, prey.z);
    actor.huntArrow = { origin: { x: actor.x, y: actor.y + .8, z: actor.z },
      target: { x: prey.x, y: height + .4, z: prey.z }, duration: Math.max(.15, distance / 10) };
    actor.phase = "huntFlight"; actor.timer = actor.huntArrow.duration; actor.action = "idle";
    context.options.onWorkerPhase?.(actor);
    return true;
  }
  if (actor.phase === "huntCollect") {
    if (!moveActor(context, actor, dt)) return true;
    if (prey.collectible) finish();
    else { actor.action = "idle"; building.status = "Waiting for prey to fall"; }
    return true;
  }
  if (actor.phase === "huntChase") {
    // Its own clock: every free step resets `timer`, the walk's blocked-wait clock (moveActor).
    actor.huntReplan = (actor.huntReplan ?? 0) - dt;
    const arrived = moveActor(context, actor, dt);
    if (!arrived && actor.huntReplan > 0) return true;
    actor.huntReplan = undefined;
    actor.phase = "huntWait"; actor.timer = 0;
  }
  actor.timer -= dt;
  if (actor.timer > 0) return true;
  return finishHuntWait(context, actor, building, prey, distance);
};

/** Event-plan entry point: resolve the wait/approach timer against the live target. */
export const completeHuntWait = (
  context: SettlementContext, actor: SettlementActor, finish: () => void
) => {
  if (actor.phase !== "huntWait") return false;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  if (!building || building.typeId !== 22 || !actor.target || !context.options.getHuntTarget ||
    !context.options.hitHuntTarget) return false;
  const prey = context.options.getHuntTarget(actor.target.id);
  if (!prey) { actor.huntArrow = undefined; finish(); return true; }
  Object.assign(actor.target, { x: prey.x, z: prey.z });
  const distance = DMath.hypot(actor.x - prey.x, actor.z - prey.z);
  building.working = true;
  return finishHuntWait(context, actor, building, prey, distance);
};

/** Event-plan entry point: resolve the aim-release boundary against the live target. */
export const completeHuntAim = (
  context: SettlementContext, actor: SettlementActor, finish: () => void
) => {
  if (actor.phase !== "huntAim") return false;
  const prey = actor.target ? context.options.getHuntTarget?.(actor.target.id) : undefined;
  if (!prey) { finish(); return false; }
  const distance = DMath.hypot(actor.x - prey.x, actor.z - prey.z);
  if (prey.fleeing || prey.dead || distance > HUNT_RANGE || distance < 2) {
    actor.phase = "huntWait"; actor.action = "idle"; actor.timer = 0;
    context.options.onWorkerPhase?.(actor);
    return false;
  }
  const height = sampleSmooth(context.options.world, context.options.world.heights, prey.x, prey.z);
  actor.huntArrow = { origin: { x: actor.x, y: actor.y + .8, z: actor.z },
    target: { x: prey.x, y: height + .4, z: prey.z }, duration: Math.max(.15, distance / 10) };
  actor.phase = "huntFlight"; actor.timer = actor.huntArrow.duration; actor.action = "idle";
  actor.yaw = DMath.atan2(prey.x - actor.x, prey.z - actor.z);
  context.options.onWorkerPhase?.(actor);
  return true;
};

/** Event-plan entry point: resolve a scheduled arrow flight at its landing boundary. */
export const completeHuntFlight = (
  context: SettlementContext, actor: SettlementActor, finish: () => void
) => {
  if (actor.phase !== "huntFlight") return false;
  const prey = actor.target ? context.options.getHuntTarget?.(actor.target.id) : undefined;
  if (!prey) { finish(); return false; }
  if (!prey.dead) shootAnimal(context, actor, actor.target!.id);
  actor.huntArrow = undefined;
  actor.phase = "huntWait"; actor.action = "idle"; actor.timer = .3;
  context.options.onWorkerPhase?.(actor);
  return true;
};

import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import type { MilitaryDirectSave } from "./military-direct-state";
import { militaryGroundPath } from "./military-routing";
import type { CombatCore } from "./settlement-combat-core";
import type { CombatRouting } from "./settlement-combat-routing";
import { isMountedNavigationClear, isNavigationFootprintClear } from "./settlement-navigation";
import { moveActor, setActorPath } from "./settlement-paths";
import { forEachNearbyTrafficActor, updatePersonTraffic } from "./settlement-person-index";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementPoint } from "./settlement-types";

/** Owns only transitions of the commander's existing mount. It never creates or replaces a horse. */
export const createMilitaryDirectHorse = (core: CombatCore, routing: CombatRouting, state: () => MilitaryDirectSave) => {
  const { actorById, context } = core;
  const ground = (point: SettlementPoint) => sampleSmooth(context.options.world, context.options.world.heights, point.x, point.z);
  const pair = () => {
    const soldier = context.commander?.soldier(), actor = soldier && actorById(soldier.actor);
    const horse = soldier?.combat?.mount !== undefined && actorById(soldier.combat.mount);
    if (!soldier?.combat || !actor || !horse || horse.job !== "Mount" || horse.phase !== "horseMounted") return null;
    return { actor, horse, soldier, combat: soldier.combat };
  };
  const isClearBeside = (point: SettlementPoint, actor: SettlementActor, horse: SettlementActor, mounted = false) =>
    (mounted ? isMountedNavigationClear(context, point) : isNavigationFootprintClear(context, point)) &&
    !forEachNearbyTrafficActor(context, point, 2.5, other => other !== actor && other !== horse && other.visible &&
      DMath.hypot(other.x - point.x, other.z - point.z) < actorSeparation(mounted ? horse : actor, other));
  const besidePoints = (source: SettlementActor) =>
    [1, -1].map(sign => ({ x: source.x + DMath.cos(source.yaw) * .7 * sign,
      z: source.z - DMath.sin(source.yaw) * .7 * sign }));
  const sideOf = (source: SettlementActor, actor: SettlementActor, horse: SettlementActor, mounted = false) =>
    besidePoints(source).find(point => isClearBeside(point, actor, horse, mounted));
  /** Static clearance alone does not connect a coast/obstacle approach to the actual horse. */
  const pathBeside = (actor: SettlementActor, horse: SettlementActor) => {
    for (const target of besidePoints(actor)) {
      if (!isClearBeside(target, actor, horse, true)) continue;
      const path = militaryGroundPath(context, horse, target, true);
      if (path) return path;
    }
    return null;
  };
  const dismount = () => {
    const found = pair();
    if (!found || !found.actor.mounted || found.combat.attackTime || found.combat.pendingTarget !== undefined) return false;
    const { actor, combat, horse } = found, side = sideOf(actor, actor, horse);
    if (!side) return false;
    routing.stand(actor);
    Object.assign(horse, { x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw,
      visible: true, action: "idle", path: [], pathIndex: 0 });
    actor.mounted = false; combat.dismounted = true;
    Object.assign(actor, side, { y: ground(side) });
    updatePersonTraffic(context, actor); updatePersonTraffic(context, horse);
    state().horse = { actor: actor.uid, horse: horse.uid, phase: "waiting", timer: 0, replan: 0 };
    return true;
  };
  const call = () => {
    const found = pair();
    if (!found || found.actor.mounted || !found.combat.dismounted || found.horse.navalOrder !== undefined ||
      found.actor.navalOrder !== undefined) return false;
    const { actor, horse } = found;
    const path = pathBeside(actor, horse);
    if (!path) return false;
    state().horse = { actor: actor.uid, horse: horse.uid, phase: "calling", timer: 0, replan: 1 };
    horse.visible = true;
    setActorPath(horse, path, "horseMounted");
    return true;
  };
  const update = (dt: number) => {
    const control = state().horse;
    if (!control) return;
    const found = pair();
    if (!found || found.actor.uid !== control.actor || found.horse.uid !== control.horse ||
      found.actor.mounted || !found.actor.visible || found.actor.phase !== "militaryField" || found.combat.hp <= 0) {
      const horse = actorById(control.horse);
      if (horse) { horse.visible = false; horse.action = "idle"; horse.path = []; horse.pathIndex = 0; }
      state().horse = undefined; return;
    }
    const { actor, combat, horse } = found;
    if (control.phase === "waiting") { horse.action = "idle"; return; }
    if (control.phase === "mounting") {
      // A committed strike, moved rider or new obstacle aborts the transition without teleporting either body.
      if (combat.attackTime || actor.navalOrder !== undefined || DMath.hypot(actor.x - horse.x, actor.z - horse.z) > .95 ||
        !isMountedNavigationClear(context, horse)) { control.phase = "waiting"; control.timer = 0; return; }
      routing.stand(actor);
      control.timer = Math.max(0, control.timer - dt);
      if (control.timer > 0) return;
      actor.mounted = true; combat.dismounted = undefined;
      Object.assign(actor, { x: horse.x, y: horse.y, z: horse.z, yaw: horse.yaw });
      horse.visible = false; horse.action = "idle";
      updatePersonTraffic(context, actor); updatePersonTraffic(context, horse);
      state().horse = undefined;
      return;
    }
    const distance = DMath.hypot(actor.x - horse.x, actor.z - horse.z);
    if (distance <= .9 && !combat.attackTime && isMountedNavigationClear(context, horse) &&
      isClearBeside(horse, actor, horse, true)) {
      control.phase = "mounting"; control.timer = .6; horse.action = "idle"; return;
    }
    control.replan = Math.max(0, control.replan - dt);
    if (!control.replan) {
      const final = horse.path.at(-1);
      const retained = final && besidePoints(actor).some(target =>
        DMath.hypot(final.x - target.x, final.z - target.z) < .75 && isClearBeside(target, actor, horse, true));
      if (!retained) {
        const path = pathBeside(actor, horse);
        if (!path) { control.phase = "waiting"; horse.action = "idle"; return; }
        setActorPath(horse, path, "horseMounted");
      }
      control.replan = 1;
    }
    const waypoint = horse.path[horse.pathIndex];
    if (!waypoint) { horse.action = "idle"; return; }
    const length = DMath.hypot(waypoint.x - horse.x, waypoint.z - horse.z) || 1;
    const share = Math.min(1, .2 / length);
    const next = { x: horse.x + (waypoint.x - horse.x) * share, z: horse.z + (waypoint.z - horse.z) * share };
    if (!isMountedNavigationClear(context, next)) { horse.action = "idle"; control.replan = 0; return; }
    moveActor(context, horse, dt);
    horse.animationTime += dt;
  };
  return { call, dismount, update,
    manages: (uid: number) => state().horse?.actor === uid,
    mounting: (uid: number) => state().horse?.actor === uid && state().horse?.phase === "mounting",
    cancel: (uid: number) => {
      const control = state().horse;
      if (control?.actor !== uid) return;
      const horse = actorById(control.horse);
      if (horse) { horse.visible = false; horse.action = "idle"; horse.path = []; horse.pathIndex = 0;
        updatePersonTraffic(context, horse); }
      state().horse = undefined;
    }
  };
};

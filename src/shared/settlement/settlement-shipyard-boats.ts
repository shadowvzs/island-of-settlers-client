import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { DMath } from "../math/deterministic-math";
import { emitWareProduced } from "../script-world/script-building-events";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import { isHomeBuilding } from "./settlement-home";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import {
  advanceWareTransfer,
  clearWareTransfer,
  startWareTransfer,
  stockContact
} from "./settlement-stock-transfers";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { stockErrandPath } from "./settlement-worker-stock-paths";

export const SHIPYARD_BOAT_WORK_SECONDS = 14;

/** Workshop boats keep a paid receipt until the same worker deposits the finished craft at HQ. */
export const createShipyardBoats = (context: SettlementContext) => {
  const workstation = (building: SettlementBuilding) => {
    const { modelOriginOffset, plot: { scale } } = requireBuildingGeometry(36);
    const offset = modelOriginOffset ?? [0, 0, 0];
    const angle = (building.rotation * Math.PI) / 2;
    const local = { x: (1.21 + offset[0]!) * scale, z: (-.12 + offset[2]!) * scale };
    return {
      x: building.x + local.x * DMath.cos(angle) + local.z * DMath.sin(angle),
      z: building.z - local.x * DMath.sin(angle) + local.z * DMath.cos(angle)
    };
  };
  const carryHome = (actor: SettlementActor, building: SettlementBuilding) => {
    const home = context.buildings.find(
      (candidate) => isHomeBuilding(candidate) && candidate.construction === 1
    );
    const approach = groundPath(context, actor, building.access, building.uid);
    const road = home && context.options.roads.route(building.access, home.access);
    if (!home || !road || !approach || home.accepts.boat === false) {
      actor.phase = "boatHomeBlocked";
      actor.action = "idle";
      actor.timer = 1;
      building.status = "Waiting for boat route to headquarters";
      return;
    }
    actor.home = home.uid;
    setActorPath(actor, [...approach, ...road.points], "home");
  };
  const update = (
    actor: SettlementActor,
    building: SettlementBuilding,
    dt: number,
    enabled: boolean
  ) => {
    const committed = actor.boatWork !== undefined;
    if (!committed) {
      if (!enabled || !["inside", "rest"].includes(actor.phase)) return false;
      actor.timer = Math.max(0, actor.timer - dt);
      building.working = false;
      if (actor.timer > 0) return true;
      if (building.productionPaused) {
        building.status = "Production stopped";
        return true;
      }
      if (!(building.input.planks ?? 0)) {
        building.status = "Waiting for planks";
        return true;
      }
      const stand = workstation(building);
      if (!groundPath(context, building.access, stand, building.uid)) {
        building.status = "Boat workshop access blocked";
        return true;
      }
      actor.stockBuilding = building.uid;
      actor.stockContact = stockContact(
        context,
        building,
        "input",
        "planks",
        (building.input.planks ?? 1) - 1
      );
      const path = stockErrandPath(context, actor, building, actor.stockContact.approach);
      if (!path) {
        building.status = "Input stock access blocked";
        return true;
      }
      actor.boatWork = 0;
      setActorPath(actor, path, "boatInputWalk");
    }
    if (actor.phase === "boatInputWalk" && moveActor(context, actor, dt)) {
      if (!(building.input.planks ?? 0)) {
        actor.boatWork = undefined;
        actor.phase = "rest";
        return true;
      }
      building.input.planks!--;
      actor.consumed = { planks: 1 };
      actor.ware = "planks";
      startWareTransfer(actor, "pickup", "planks", actor.stockContact!);
      actor.phase = "boatInputPickup";
    } else if (actor.phase === "boatInputPickup" || actor.phase === "boatWorkshopBlocked") {
      if (actor.phase === "boatInputPickup" && !advanceWareTransfer(actor, dt)) return true;
      clearWareTransfer(actor);
      const path = groundPath(context, actor, workstation(building), building.uid);
      if (path) setActorPath(actor, path, "boatWorkshopWalk");
      else {
        actor.phase = "boatWorkshopBlocked";
        actor.action = "idle";
      }
    } else if (actor.phase === "boatWorkshopWalk" && moveActor(context, actor, dt)) {
      actor.ware = null;
      actor.phase = "boatWork";
      actor.action = "work";
      actor.timer = SHIPYARD_BOAT_WORK_SECONDS;
      actor.yaw = (building.rotation * Math.PI) / 2 - Math.PI / 2;
    } else if (actor.phase === "boatWork") {
      building.working = true;
      building.status = "Building boat";
      actor.action = "work";
      actor.timer = Math.max(0, actor.timer - dt);
      actor.boatWork = 1 - actor.timer / SHIPYARD_BOAT_WORK_SECONDS;
      if (!actor.timer) {
        actor.ware = "boat";
        context.options.onProductionCycle?.(building, actor.consumed ?? {}, "boat");
        if (context.script) emitWareProduced(context, building, "boat");
        actor.consumed = undefined;
        building.working = false;
        carryHome(actor, building);
      }
    } else if (actor.phase === "boatHomeBlocked") {
      actor.timer -= dt;
      if (actor.timer <= 0) carryHome(actor, building);
    } else if (actor.phase === "home" && moveActor(context, actor, dt)) {
      const home = context.buildings.find((candidate) => candidate.uid === actor.home)!;
      if (canEnterDoor(context, actor, home)) setActorPath(actor, entrancePath(home), "enterHome");
    } else if (actor.phase === "enterHome" && moveActor(context, actor, dt)) {
      const home = context.buildings.find((candidate) => candidate.uid === actor.home)!;
      home.inventory.boat = (home.inventory.boat ?? 0) + 1;
      actor.ware = null;
      actor.visible = false;
      actor.boatWork = -1;
      const road = context.options.roads.route(home.access, building.access);
      if (road) setActorPath(actor, [...exitPath(home), ...road.points], "assigned");
      else {
        actor.phase = "boatReturnBlocked";
        actor.action = "idle";
        actor.timer = 1;
      }
    } else if (actor.phase === "boatReturnBlocked") {
      actor.timer -= dt;
      if (actor.timer <= 0) {
        const home = context.buildings.find((candidate) => candidate.uid === actor.home)!;
        const road = context.options.roads.route(home.access, building.access);
        actor.timer = 1;
        if (road) setActorPath(actor, [...exitPath(home), ...road.points], "assigned");
      }
    } else if (actor.phase === "assigned" && moveActor(context, actor, dt)) {
      if (canEnterDoor(context, actor, building))
        setActorPath(actor, entrancePath(building), "enterAssigned");
    } else if (actor.phase === "enterAssigned" && moveActor(context, actor, dt)) {
      actor.boatWork = undefined;
      actor.stockBuilding = undefined;
      actor.visible = false;
      actor.phase = "rest";
      actor.action = "idle";
      actor.timer = 2;
    }
    return true;
  };
  const frames = () =>
    context.actors
      .filter((actor) => actor.phase === "boatWork")
      .flatMap((actor) => {
        const building = context.buildings.find((candidate) => candidate.uid === actor.building);
        if (!building) return [];
        const { modelOriginOffset, plot: { scale } } = requireBuildingGeometry(36);
    const offset = modelOriginOffset ?? [0, 0, 0];
        const angle = (building.rotation * Math.PI) / 2;
        return [
          {
            id: -actor.uid - 1,
            x: building.x + ((.66 + offset[0]!) * DMath.cos(angle) + (-.27 + offset[2]!) * DMath.sin(angle)) * scale,
            z: building.z + (-(.66 + offset[0]!) * DMath.sin(angle) + (-.27 + offset[2]!) * DMath.cos(angle)) * scale,
            y: building.y + 0.57 * scale,
            yaw: angle,
            progress: actor.boatWork ?? 0,
            kind: "boat" as const,
            scale: 0.63 * scale
          }
        ];
      });
  return { update, frames };
};

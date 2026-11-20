import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { expansionDrinkWorkstation } from "../../render-common/buildings/expansion-drink-maker-layout";
import { isBuildingFirstNation, type WorkerNation } from "../../render-common/workers/worker-nation";
import { DMath } from "../math/deterministic-math";
import { buildingNation } from "./settlement-nation";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { stockErrandPath } from "./settlement-worker-stock-paths";

export const isExpansionDrinkMaker = (building: SettlementBuilding, nation: WorkerNation = "roman") =>
  building.typeId === 6 && isBuildingFirstNation(nation);

/** The same authored stance as the visible tools, rotated/scaled into settlement coordinates. */
export const drinkWorkstation = (building: SettlementBuilding, nation: WorkerNation = "roman") => {
  if (!isBuildingFirstNation(nation)) return null;
  const layout = expansionDrinkWorkstation(nation);
  const { scale } = requireBuildingGeometry(6).plot;
  const rotation = building.rotation * Math.PI / 2;
  const cosine = DMath.cos(rotation), sine = DMath.sin(rotation);
  const x = layout.workerStand[0] * scale, z = layout.workerStand[2] * scale;
  return { point: { x: building.x + x * cosine + z * sine,
    z: building.z - x * sine + z * cosine }, yaw: rotation + layout.heading };
};

/** Reach the open maker bench via the existing stock courtyard and doorway-clearance search. */
export const approachDrinkWorkstation = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  const station = drinkWorkstation(building, buildingNation(context, building));
  if (!station) return;
  actor.stockBuilding = building.uid;
  building.working = false;
  const path = stockErrandPath(context, actor, building, station.point);
  if (path) setActorPath(actor, path, "outbound");
  else {
    actor.phase = "drinkWorkBlocked";
    actor.action = "idle";
    actor.timer = 1;
  }
  building.door = 1;
};

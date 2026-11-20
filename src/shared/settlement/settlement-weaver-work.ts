import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { WEAVER_LOOM } from "../../render-common/buildings/weaver-loom";
import { DMath } from "../math/deterministic-math";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { stockErrandPath } from "./settlement-worker-stock-paths";

export const weaverWorkstation = (building: SettlementBuilding) => {
  const { scale } = requireBuildingGeometry(61).plot;
  const rotation = building.rotation * Math.PI / 2;
  const cosine = DMath.cos(rotation), sine = DMath.sin(rotation);
  // Stand beyond the front flax tray, including the worker's collision radius.
  const x = WEAVER_LOOM.x * scale, z = WEAVER_LOOM.z * scale + .7;
  return { point: { x: building.x + x * cosine + z * sine,
    z: building.z - x * sine + z * cosine }, yaw: rotation + Math.PI };
};

/** Use the same doorway/courtyard clearance as fetching the loom's real flax basket. */
export const approachWeaverWorkstation = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => {
  actor.stockBuilding = building.uid;
  building.working = false;
  const path = stockErrandPath(context, actor, building, weaverWorkstation(building).point);
  if (path) setActorPath(actor, path, "outbound");
  else {
    actor.phase = "weaverWorkBlocked";
    actor.action = "idle";
    actor.timer = 1;
  }
  building.door = 1;
};

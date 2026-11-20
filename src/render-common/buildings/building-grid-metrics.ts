import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { DMath } from "../../shared/math/deterministic-math";
import { ROAD_WIDTH } from "../../shared/settlement/road-types";
import { type BuildingDefinition,getBuildingDefinition } from "./building-catalog";
import { type BuildingLogisticsAnchors, transformBuildingLogisticsAnchors } from "./building-logistics-anchors";
import type { Point3 } from "./building-recipe";
import { MONUMENT_TYPE_ID } from "./monument-definition";

const calculateGridMetrics = (definition: BuildingDefinition) => {
  const { door, ground, logistics, plot, workerExit } = requireBuildingGeometry(definition.id);
  const { scale } = plot;
  return {
    cells: plot.cells, scale, origin: "foundation-centre", accessSide: "+Z", accessMargin: 1,
    logistics: logistics as unknown as BuildingLogisticsAnchors,
    workerExit: [...workerExit] as Point3,
    doorHinge: door.hinge.map((value) => value * scale) as Point3,
    ground
  };
};
const cache = new Map<number, ReturnType<typeof calculateGridMetrics>>();

/** Both LOD renderers and gameplay read one stored High-recipe scale (geometry sidecar); no recipe runs. */
export const getRomanBuildingGridMetrics = (definition: BuildingDefinition) => {
  let metrics = cache.get(definition.id);
  if (!metrics) { metrics = calculateGridMetrics(definition); cache.set(definition.id, metrics); }
  return metrics;
};

/** Actual door lane, plus a half-cell road endpoint in the reserved access cell. */
export const getPlacedBuildingLogistics = (typeId: number, x: number, z: number, quarterTurns: number) => {
  const definition = getBuildingDefinition(typeId);
  const metrics = getRomanBuildingGridMetrics(definition);
  const anchors = transformBuildingLogisticsAnchors(metrics.logistics, quarterTurns, [x, 0, z]);
  const angle = (((quarterTurns % 4) + 4) % 4) * Math.PI / 2;
  const { entrance, plot } = requireBuildingGeometry(typeId);
  const swingFront = Math.max(0, ...entrance.map(bounds => bounds.max[2] * plot.scale));
  // A widened public ribbon must stay beyond the full open door, including corner sweeps.
  const front = Math.max(definition.gridFootprint[1] / 2 + 0.5,
    Math.ceil((swingFront + ROAD_WIDTH / 2 + 0.08) * 2) / 2);
  const lateral = metrics.logistics.doorThreshold[0];
  const road = { x: Math.round((x + lateral * DMath.cos(angle) + front * DMath.sin(angle)) * 2) / 2,
    z: Math.round((z - lateral * DMath.sin(angle) + front * DMath.cos(angle)) * 2) / 2 };
  return {
    road,
    workerApproach: { x: anchors.workerApproach[0], z: anchors.workerApproach[2] },
    doorThreshold: definition.style === "well"
      ? { x: anchors.workerApproach[0], z: anchors.workerApproach[2] }
      : { x: anchors.doorThreshold[0], z: anchors.doorThreshold[2] },
    hasDoor: definition.style !== "well" && typeId !== MONUMENT_TYPE_ID,
    scale: metrics.scale
  };
};

import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingRecipe, Point3 } from "./building-recipe";

/** Fitted grid units, before world translation/rotation. Never apply the model scale twice. */
export interface BuildingLogisticsAnchors {
  carrierApproach: Point3;
  carrierHandoff: Point3;
  carrierQueue: Point3[];
  doorThreshold: Point3;
  roadConnection: Point3;
  workerApproach: Point3;
  workerExit: Point3;
}

/**
 * Carrier service positions occupy the reserved front cell, beyond all fitted stock props.
 * Exterior stocks are inventory displays; pickup/delivery happen at the handoff instead
 * of pathfinding to every sack. The central doorway lane remains available to workers.
 */
export const createBuildingLogisticsAnchors = (
  recipe: Pick<BuildingRecipe, "door" | "workerExit">,
  cells: readonly [number, number],
  scale: number
): BuildingLogisticsAnchors => {
  const [width, depth] = cells;
  const entranceX = recipe.workerExit[0] * scale;
  const front = depth / 2;
  const side = entranceX >= 0 ? -1 : 1;
  const handoffX = entranceX + side * 0.42;
  const serviceX = Math.max(-width / 2 + 0.08, Math.min(width / 2 - 0.08, handoffX));
  return {
    carrierApproach: [serviceX, 0, front + 0.94],
    carrierHandoff: [serviceX, 0, front + 0.22],
    carrierQueue: [
      [serviceX, 0, front + 0.5],
      [serviceX, 0, front + 0.78]
    ],
    doorThreshold: [entranceX, 0, recipe.door[2] * scale],
    roadConnection: [entranceX, 0, front + 1],
    workerApproach: [entranceX, 0, front + 0.22],
    workerExit: recipe.workerExit.map((value) => value * scale) as Point3
  };
};

/** Match a Three.js positive Y quarter-turn, without importing a renderer. */
export const transformBuildingLogisticsAnchors = (
  anchors: BuildingLogisticsAnchors,
  quarterTurns: number,
  origin: Point3 = [0, 0, 0]
): BuildingLogisticsAnchors => {
  const angle = ((((quarterTurns % 4) + 4) % 4) * Math.PI) / 2;
  const cosine = Math.round(DMath.cos(angle));
  const sine = Math.round(DMath.sin(angle));
  const transform = ([x, y, z]: Point3): Point3 => [
    origin[0] + x * cosine + z * sine,
    origin[1] + y,
    origin[2] - x * sine + z * cosine
  ];
  return {
    carrierApproach: transform(anchors.carrierApproach),
    carrierHandoff: transform(anchors.carrierHandoff),
    carrierQueue: anchors.carrierQueue.map(transform),
    doorThreshold: transform(anchors.doorThreshold),
    roadConnection: transform(anchors.roadConnection),
    workerApproach: transform(anchors.workerApproach),
    workerExit: transform(anchors.workerExit)
  };
};

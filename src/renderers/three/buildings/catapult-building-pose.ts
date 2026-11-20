import { type Mesh, type Object3D } from "three";

import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { getRomanBuildingWorldSizing } from "../../../render-common/buildings/building-world-sizing";
import { CATAPULT_HATCH, CATAPULT_TRAVERSE } from "../../../render-common/buildings/catapult-mechanism";
import { CATAPULT_ANCHORS, type CatapultCycle, catapultLoosePoint, catapultPose, rotateCatapultMechanismPoint } from "../../../shared/settlement/catapult-cycle";
import { catapultHatchOpening, type CatapultSupply } from "../../../shared/settlement/military-catapult-resupply";

const catapultScale = getRomanBuildingWorldSizing(getBuildingDefinition(16)).scale;

/** Engine joints orbit one bearing. The fixed hatch has its own downward hinge. */
export const prepareCatapultMesh = (mesh: Mesh, kind: NonNullable<BuildingPart["catapultPart"]>) => {
  let pivot: readonly number[] = CATAPULT_ANCHORS.pivot;
  if (kind === "frame") pivot = CATAPULT_ANCHORS.turntable;
  if (kind === "crank") pivot = CATAPULT_ANCHORS.crank;
  if (kind === "trigger") pivot = CATAPULT_TRAVERSE.trigger;
  if (kind === "hatch") pivot = CATAPULT_HATCH.hinge;
  mesh.name = `catapult_${kind}`;
  mesh.userData.catapultPart = kind; mesh.userData.catapultPivot = [...pivot];
  mesh.geometry.translate(-pivot[0]!, -pivot[1]!, -pivot[2]!); mesh.position.set(pivot[0]!, pivot[1]!, pivot[2]!);
};
export const updateCatapultMesh = (
  object: Object3D, cycle: CatapultCycle | undefined, aim: number, construction: number, supply?: CatapultSupply
) => {
  const kind = object.userData.catapultPart as BuildingPart["catapultPart"];
  if (!kind) return;
  const pivot = object.userData.catapultPivot as number[];
  if (kind === "hatch") {
    const opening = catapultHatchOpening(supply?.porter);
    object.position.set(...pivot as [number, number, number]); object.rotation.set(0, 0, -Math.max(0, opening) * Math.PI / 2);
    object.visible = construction === 1; return;
  }
  const pose = catapultPose(cycle);
  if (kind === "loaded" && cycle?.ammoPoint && (cycle.ammo === "loose" || cycle.ammo === "cup")) {
    // This mesh is already centered on the released stone, so no mechanism pitch applies to a loose item.
    const point = catapultLoosePoint(cycle, catapultScale);
    object.position.set(point[0] - CATAPULT_ANCHORS.release[0] + pivot[0]!,
      point[1] - CATAPULT_ANCHORS.release[1] + pivot[1]!, point[2] - CATAPULT_ANCHORS.release[2] + pivot[2]!);
    object.rotation.set(0, 0, 0);
    object.visible = construction === 1 && !(cycle.phase === "retrieve" && pose.pickup !== undefined);
    return;
  }
  const position = rotateCatapultMechanismPoint(pivot, aim);
  object.position.set(...position);
  let pitch = 0;
  if (kind === "arm" || kind === "loaded") pitch = pose.arm;
  if (kind === "crank") pitch = pose.crankAngle;
  if (kind === "trigger") object.position.y -= pose.trigger * .04;
  object.rotation.set(pitch, aim, 0, "YXZ");
  object.visible = construction === 1 && (kind !== "loaded" || pose.loaded);
};

import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../../render-common/buildings/building-world-sizing";
import { CATAPULT_STONE_DIAMETER, CATAPULT_TRAVERSE, catapultCrankHands } from "../../render-common/buildings/catapult-mechanism";
import { CATAPULT_HOME_YAW, catapultCrewLocalPose,
  rotateCatapultMechanismPoint } from "../../shared/settlement/catapult-cycle";
import type { SettlementActor, SettlementBuilding } from "../../shared/settlement/settlement-types";

/** Fixed deck/rack handling and hand-powered motion around the launcher share exact authored contacts. */
export const catapultCrewView = (actor: SettlementActor, building: SettlementBuilding): SettlementActor => {
  const cycle = building.catapultCycle;
  const scale = getRomanBuildingWorldSizing(getBuildingDefinition(16)).scale;
  const base = building.rotation * Math.PI / 2, aim = building.catapultAim ?? CATAPULT_HOME_YAW;
  const world = (source: readonly number[], rotating = false) => {
    const point = rotating ? rotateCatapultMechanismPoint(source, aim) : source;
    return { x: building.x + (point[0]! * Math.cos(base) + point[2]! * Math.sin(base)) * scale,
      y: building.y + point[1]! * scale,
      z: building.z + (point[2]! * Math.cos(base) - point[0]! * Math.sin(base)) * scale };
  };
  const pose = catapultCrewLocalPose(cycle, aim, scale, building.input.stone ?? 0);
  const at = world(pose.operator);
  const pickup = world(pose.pickupPoint), cup = world(pose.cupPoint);
  const carryPoint = world(pose.carryPoint), yaw = base + pose.yaw;
  const view: SettlementActor = { ...actor, ...at, action: pose.walking ? "walk" : "idle", animationTime: cycle?.elapsed ?? 0,
    catapultOperator: { phase: cycle?.phase ?? "return", progress: cycle ? pose.progress : 1,
      stoneDiameter: CATAPULT_STONE_DIAMETER * scale, carryPoint, handWeight: pose.handWeight, reverseWalk: pose.reverse, walking: pose.walking },
    lean: 0, path: [], pathIndex: 0, phase: "garrisonView", tool: undefined,
    visible: true, ware: null, wareTransfer: undefined, yaw };
  if (pose.carrying) { view.ware = "stone"; view.action = "carry"; }
  if (pose.pickup !== undefined) {
    view.action = "idle";
    view.wareTransfer = { direction: "pickup", progress: pose.pickup, target: pickup, ware: "stone" };
  }
  if (pose.putdown !== undefined) {
    view.action = "idle";
    view.wareTransfer = { direction: "putdown", progress: pose.putdown, target: cup, ware: "stone" };
  }
  if (pose.hands) {
    const points: number[][] = (pose.hands === "crank" ? catapultCrankHands(pose.crankAngle) : CATAPULT_TRAVERSE.hands).map(point => [...point]);
    if (pose.phase === "return") {
      const amount = Math.min(1, pose.progress * 2);
      points[1] = points[1]!.map((value, axis) => {
        const from = CATAPULT_TRAVERSE.trigger[axis]! - (axis === 1 ? pose.trigger * .04 : 0);
        return from + (value - from) * amount;
      });
    }
    if (pose.hands === "release") {
      const grasp = Math.min(1, pose.progress / .3), trigger = [...CATAPULT_TRAVERSE.trigger]; trigger[1] = trigger[1]! - pose.trigger * .04;
      points[1] = points[1]!.map((value, axis) => value + (trigger[axis]! - value) * grasp);
    }
    const hands = points.map(point => { const target = world(point, true); return [target.x, target.y, target.z] as const; });
    view.catapultOperator!.hands = [hands[0]!, hands[1]!];
  }
  return view;
};

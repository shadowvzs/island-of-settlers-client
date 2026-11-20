import {
  assignGarrisonSlots, garrisonSlots, garrisonWindowFrame, placeGarrisonSlot
} from "../../render-common/buildings/military-garrison-slots";
import { placeWindowSoldier } from "../../render-common/buildings/window-soldier-head-envelope";
import { windowSoldierPose } from "../../render-common/buildings/window-soldier-pose";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { isCatapultPorter } from "../../shared/settlement/military-catapult-resupply";
import {
  buildingFootprint, GARRISON_ARCHER_MAX_REACH, garrisonArcherReach, isUnderWalls
} from "../../shared/settlement/settlement-garrison-archers";
import { militaryArmourRank } from "../../shared/settlement/settlement-military-ranks";
import type { SettlementActor, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { catapultCrewView } from "./catapult-crew-view";

interface StationedSoldier {
  actor: number; building: number; rank?: number; stationed: boolean; combat?: { faction: number; type: string };
}
type Point = { x: number; y: number; z: number };

/** A tower archer turns to the nearest enemy it can shoot (within its post's reach, beyond the dead zone). */
const aimYaw = (
  from: Point, building: SettlementBuilding, faction: number, nation: WorkerNation,
  enemies: ReadonlyArray<Point & { faction: number }>, fallback: number
) => {
  const footprint = building.eventCourtyard ?
    { x: from.x, z: from.z, halfWidth: .4, halfDepth: .4 } : buildingFootprint(building);
  const post = { facing: null, floor: from.y, nation,
    soldier: { combat: { faction } } } as never;
  let best = fallback, bestDistance = GARRISON_ARCHER_MAX_REACH;
  for (const enemy of enemies) {
    const distance = Math.hypot(enemy.x - from.x, enemy.z - from.z);
    if (enemy.faction === faction || distance > bestDistance || isUnderWalls(footprint, enemy.x, enemy.z) ||
      distance > garrisonArcherReach(post, enemy.y)) continue;
    best = Math.atan2(enemy.x - from.x, enemy.z - from.z); bestDistance = distance;
  }
  return best;
};
/**
 * Visible stand-ins for garrisoned soldiers (the real actors stay hidden inside): archers on the
 * archer posts, everyone else (and spare archers) leaning out of the windows; the rest stay unseen.
 */
export const garrisonViewActors = (
  buildings: readonly SettlementBuilding[], soldiers: readonly StationedSoldier[], actors: readonly SettlementActor[],
  nation: WorkerNation = "roman",
  /** The drawn recipe: one answer for every building, or per building in the possessed view (R16b). */
  detailed: boolean | ((building: SettlementBuilding) => boolean) = true
) => {
  const stationed = new Map<number, StationedSoldier[]>();
  for (const soldier of soldiers) {
    if (!soldier.stationed) continue;
    const list = stationed.get(soldier.building) ?? [];
    list.push(soldier); stationed.set(soldier.building, list);
  }
  if (!stationed.size) return [];
  const byId = new Map(actors.map(actor => [actor.uid, actor]));
  const enemies = soldiers.flatMap(soldier => {
    const actor = byId.get(soldier.actor);
    return actor?.phase === "militaryField" ? [{ faction: soldier.combat?.faction ?? 0, x: actor.x, y: actor.y, z: actor.z }] : [];
  });
  const views: SettlementActor[] = [];
  for (const building of buildings) {
    const garrison = stationed.get(building.uid)?.filter(soldier => !isCatapultPorter(building, soldier.actor));
    if (!garrison || building.construction < 1) continue;
    const model = building.militaryFaction ? building.bandit : undefined;
    const drawnDetailed = typeof detailed === "boolean" ? detailed : detailed(building);
    const slots = garrisonSlots(building.typeId, nation, drawnDetailed, model, building.bandit !== undefined,
      building.enemyCampEnclosure);
    for (const { slot, soldier } of assignGarrisonSlots(slots, garrison)) {
      const actor = byId.get(soldier.actor);
      if (!actor) continue;
      if (building.typeId === 16 && slot.kind === "crew") {
        views.push(catapultCrewView(actor, building)); continue;
      }
      const frame = garrisonWindowFrame(slot);
      const at = placeGarrisonSlot(slot, building);
      let lean = slot.lean, windowSillRise: number | undefined;
      // Presentation only: the soldier is fitted into the drawn opening (head, face and chest in front
      // of the window insert, helmet under the lintel, legs hidden below the sill). The slot never moves.
      if (frame) {
        const fit = windowSoldierPose(frame, nation, militaryArmourRank(soldier.rank ?? 0));
        Object.assign(at, placeWindowSoldier(at, building.y, frame, fit));
        lean = fit.lean;
        windowSillRise = frame.sill - fit.rootY;
      }
      const yaw = slot.kind === "archer"
        ? aimYaw(at, building, soldier.combat?.faction ?? 0, nation, enemies, at.yaw) : at.yaw;
      views.push({ ...actor, action: "idle", lean, path: [], pathIndex: 0, phase: "garrisonView",
        visible: true, windowSillRise, x: at.x, y: at.y, yaw, z: at.z });
    }
  }
  return views;
};

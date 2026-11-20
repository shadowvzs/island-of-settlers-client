import { isCatapultAmmoKind } from "../../shared/settlement/catapult-ammo-kinds";
import { CATAPULT_PORTER_VERTICAL_SPEED } from "../../shared/settlement/military-catapult-resupply";
import { ownerOf } from "../../shared/settlement/settlement-ownership";
import type { SettlementActor } from "../../shared/settlement/settlement-types";
import type { BuildingFrame } from "../../render-common/buildings/building-catalog";
import { BUILDING_DEMOLITION_SECONDS } from "../../render-common/buildings/building-demolition";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { settlementBuildingFrameId } from "./settlement-render-frames";

/** Economic removal stays authoritative; a short-lived shell supplies the burn-down visual. */
export const createBuildingDemolitionFrames = () => {
  const burning = new Map<number, { frame: BuildingFrame; width: number; depth: number }>();
  return {
    start: (building: SettlementBuilding, nation: WorkerNation) => {
      // Enemy forts burn down and leave their own charred ruin (colony fort assault).
    if (building.construction !== 1 || ownerOf(building) > 0) return;
      burning.set(building.uid, { width: building.width, depth: building.depth, frame: {
        id: settlementBuildingFrameId(building.uid), type: building.typeId, nation,
        x: building.x, y: building.y, z: building.z, rotation: building.rotation * Math.PI / 2,
        construction: 1, working: false, door: 1, demolitionAge: 0,
        inputStock: {}, outputStock: {}
      } });
    },
    update: (dt: number, buildings: readonly SettlementBuilding[], actors: readonly SettlementActor[] = []) => {
      const frames: BuildingFrame[] = [];
      for (const [uid, entry] of burning) {
        const frame = entry.frame;
        frame.demolitionAge! += Math.max(0, dt);
        const replaced = buildings.some(building =>
          Math.abs(building.x - frame.x) < (entry.width + building.width) / 2 &&
          Math.abs(building.z - frame.z) < (entry.depth + building.depth) / 2);
        if (frame.demolitionAge! >= BUILDING_DEMOLITION_SECONDS || replaced) {
          burning.delete(uid);
          continue;
        }
        const employee = actors.find(actor => actor.building === uid && actor.catapultEvacuation);
        const evacuation = employee?.catapultEvacuation;
        frame.catapultSupply = evacuation && evacuation.stage !== "door" ? { ground: 0, porter: {
          actor: employee!.uid, carrying: isCatapultAmmoKind(employee!.ware),
          phase: evacuation.stage === "roof" ? "roof-return" : "stairs-down",
          elapsed: evacuation.stage === "stairs" ? Math.max(0, (evacuation.deck - employee!.y) / CATAPULT_PORTER_VERTICAL_SPEED) : 0
        } } : undefined;
        frame.door = frame.demolitionAge! < 3 ? 1 : 0;
        frames.push(frame);
      }
      return frames;
    }
  };
};

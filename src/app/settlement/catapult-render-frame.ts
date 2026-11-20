import { type BuildingFrame,getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../../render-common/buildings/building-world-sizing";
import { CATAPULT_STONE_DIAMETER } from "../../render-common/buildings/catapult-mechanism";
import { catapultCarrierStoneShape } from "../../render-common/buildings/catapult-stone-presentation";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import {
  DEFAULT_CATAPULT_AMMO, isCatapultAmmoKind
} from "../../shared/settlement/catapult-ammo-kinds";
import { type CatapultPorter, isCatapultPorterOutside } from "../../shared/settlement/military-catapult-resupply";
import type { SettlementActor, SettlementBuilding, SettlementOptions } from "../../shared/settlement/settlement-types";

const stoneDiameter = CATAPULT_STONE_DIAMETER * getRomanBuildingWorldSizing(getBuildingDefinition(16)).scale;
export const updateCatapultBuildingFrame = (frame: BuildingFrame, building: SettlementBuilding,
  stockContact?: SettlementOptions["stockContact"]) => {
  frame.catapultCycle = building.catapultCycle; frame.catapultAim = building.catapultAim;
  frame.catapultSupply = building.catapultSupply;
  frame.catapultRackKinds = building.catapultRackKinds;
  frame.catapultGroundPoints = building.typeId === 16 ? Array.from({ length: building.catapultSupply?.ground ?? 0 }, (_, slot) =>
    stockContact?.(building, "input", "stone", slot)?.stock ?? { ...building.access, y: building.y + .08 }) : undefined;
};
/** Catapult cargo of any stone kind keeps the plain stone carry/transfer presentation (CAT-3 recolours). */
const presentCatapultStone = (frame: WorkerFrame, actor: SettlementActor, porter: CatapultPorter | undefined) => {
  if (!porter && !actor.catapultStoneCargo) return;
  if (isCatapultAmmoKind(frame.carryingWare) && frame.carryingWare !== DEFAULT_CATAPULT_AMMO)
    frame.carryingWare = DEFAULT_CATAPULT_AMMO;
  const transfer = frame.wareTransfer;
  if (transfer && isCatapultAmmoKind(transfer.ware) && transfer.ware !== DEFAULT_CATAPULT_AMMO)
    frame.wareTransfer = { ...transfer, ware: DEFAULT_CATAPULT_AMMO };
};
export const updateCatapultWorkerFrame = (frame: WorkerFrame, actor: SettlementActor, porter?: CatapultPorter) => {
  const ownPorter = porter?.actor === actor.uid ? porter : undefined;
  presentCatapultStone(frame, actor, ownPorter);
  frame.catapultStoneKind = ownPorter?.kind ?? (isCatapultAmmoKind(actor.ware) ? actor.ware : undefined)
    ?? (frame.wareTransfer && isCatapultAmmoKind(frame.wareTransfer.ware) ? frame.wareTransfer.ware : undefined);
  const roundStone = catapultCarrierStoneShape(ownPorter && isCatapultPorterOutside(ownPorter.phase),
    actor.catapultEvacuation?.stage) === "round";
  frame.catapultHands = actor.catapultOperator?.hands;
  frame.catapultCarryPoint = actor.catapultOperator?.carryPoint;
  frame.catapultHandWeight = actor.catapultOperator?.handWeight;
  const reverse = actor.catapultOperator?.reverseWalk;
  if (frame.catapultReverseWalk !== reverse) frame.gaitPhase = 1 - frame.gaitPhase;
  frame.catapultReverseWalk = reverse;
  frame.catapultStoneDiameter = actor.catapultOperator?.stoneDiameter ?? (roundStone ? stoneDiameter : undefined);
  frame.catapultTuckedCarry = (porter?.actor === actor.uid && (porter.phase === "stairs-up" || porter.phase === "stairs-down")) || actor.catapultEvacuation?.stage === "stairs";
};

export const catapultPorterFor = (actor: SettlementActor, buildings: ReadonlyMap<number, BuildingFrame>) => {
  const porter = buildings.get(actor.building)?.catapultSupply?.porter;
  return porter?.actor === actor.uid ? porter : undefined;
};

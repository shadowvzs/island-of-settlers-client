import { SAWMILL_RECIPES } from "@shared/catalog/balance";

import { BUILDING_CATALOG, RETIRED_BUILDING_IDS } from "../../../src/render-common/buildings/building-catalog";
import { BUILDING_MENU } from "../../../src/render-common/buildings/building-menu";
import type { WorkerNation } from "../../../src/render-common/workers/worker-unit";
import { mixedProductionChoice } from "../../../src/shared/settlement/mixed-output";
import { getProductionRule, STORAGE_IDS } from "../../../src/shared/settlement/production-rules";
import { RESIDENCE_IDS } from "../../../src/shared/settlement/residences";
import { isUpgradeableWorkshopType, maxWorkshopUpgradeLevel,workshopUpgradeCost } from "../../../src/shared/settlement/workshop-upgrades";

/** Expectations are coverage obligations, never evidence that the corresponding action passed. */
const buildingKind = (id: number, rule: ReturnType<typeof getProductionRule>) => {
  if (STORAGE_IDS.has(id)) return "storage";
  if (RESIDENCE_IDS.has(id)) return "residence";
  return rule?.service ? "service" : "producer";
};

export const createAcceptanceManifest = (nation: WorkerNation) => ({
  nation,
  retired: [...RETIRED_BUILDING_IDS],
  buildings: BUILDING_CATALOG.filter(building => !RETIRED_BUILDING_IDS.has(building.id)).map(building => {
    const rule = getProductionRule(building.id, nation);
    let modes = ["default"];
    if (rule && rule.outputs.length > 1) modes = [mixedProductionChoice(building.id), ...rule.outputs];
    if (building.id === 24) modes = rule!.outputs.map(ware => `order:${ware}`);
    if (building.id === 33) modes = [...SAWMILL_RECIPES.map(recipe => recipe.output), "handcart"];
    if (building.id === 36) modes = ["boats", "ships"];
    const upgradeable = isUpgradeableWorkshopType(building.id);
    return {
      buildable: BUILDING_MENU.some(group => group.buildings.some(entry => entry.id === building.id)),
      id: building.id, name: building.name, footprint: [...building.gridFootprint],
      role: building.role, worker: rule?.job ?? building.worker, headquarters: building.id === 0,
      placementOrder: building.style === "mine" || building.garrisonCapacity ? "last" : "ordinary",
      kind: buildingKind(building.id, rule),
      modes, tool: rule?.tool ?? null, inputs: [...(rule?.inputs ?? [])], outputs: [...(rule?.outputs ?? [])],
      alternativeFood: rule?.alternativeFood ?? false, outdoor: rule?.outdoor ?? null,
      seconds: rule?.seconds ?? null, requiredCycles: rule && !rule.service ? 3 : 0,
      recipes: building.id === 33 ? SAWMILL_RECIPES.map((recipe, offset) => ({ ...recipe, requiredLevel: offset + 1 })) : [],
      upgrade: upgradeable ? { level: 1, cost: workshopUpgradeCost({ typeId: building.id }), requiredCycles: 3,
        steps: Array.from({ length: maxWorkshopUpgradeLevel(building.id) }, (_, offset) => ({
          offset: offset + 1, displayedLevel: offset + 2,
          cost: workshopUpgradeCost({ typeId: building.id, workshopUpgrade: { level: offset as 0 | 1 | 2 | 3 } })
        })) } : null,
      serviceEvidence: rule?.service ? "Requires dedicated service/progression assertions" : null
    };
  })
});

/** Production-lane case IDs; coverage obligations resolve exactly these emitted IDs. */
export const productionModeCaseId = (buildingId: number, mode: string) =>
  `E2E-06-type-${buildingId}-${mode.replace(":", "-")}`;
export const productionUpgradeCaseId = (buildingId: number, step: { displayedLevel: number; offset: number }) => {
  const level = step.offset === 1 ? "" : `-level-${step.displayedLevel}`;
  return `E2E-06-upgrade-${buildingId}${level}`;
};
/** Buildable producers that the production lane exercises mode by mode. */
export const productionLaneBuildings = (manifest: ReturnType<typeof createAcceptanceManifest>) =>
  manifest.buildings.filter(building => building.kind === "producer" && building.buildable);

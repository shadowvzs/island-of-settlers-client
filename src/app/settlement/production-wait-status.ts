import type { I18n } from "@lingui/core";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { POPULATION_GROWTH_SECONDS } from "../../shared/balance/population";
import {
  displayMaterialName, displayWareName, displayWareNameForCount, DOMAIN_STATUS_PATTERNS,
  translateDomainMessage
} from "../../shared/i18n/domain";
import { DOMAIN_APP_MESSAGES } from "../../shared/i18n/domain-app-messages";
import { isMaterialQuarry, isMaterialWoodcutter, materialBuildingGroup } from "../../shared/settlement/advanced-material-production";
import { getBuildingProductionRule } from "../../shared/settlement/production-rules";
import {
  handcartCycleRule,
  isCraftingHandcarts
} from "../../shared/settlement/settlement-sawmill-handcarts";
import { settlerGrowthSeconds } from "../../shared/settlement/settlement-talents";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";

/** Read-only status: stock already here and reserved deliveries remain distinct. */
export const productionWaitStatus = (building: SettlementBuilding, nation: WorkerNation, i18n?: I18n) => {
  if (building.status !== "Waiting for inputs") return building.status;
  const base = getBuildingProductionRule(building, nation);
  if (!base) return building.status;
  const rule = isCraftingHandcarts(building) ? handcartCycleRule(base) : base;
  if (rule.alternativeFood) {
    if (rule.inputs.some((ware) => (building.input[ware] ?? 0) > 0)) return building.status;
    const choices = rule.inputs.map((ware) => translateDomainMessage(i18n,
      DOMAIN_STATUS_PATTERNS.incomingChoice, {
        amount: 1, incoming: building.incoming[ware] ?? 0, ware: displayWareNameForCount(ware, 1, i18n)
      }));
    return translateDomainMessage(i18n, DOMAIN_STATUS_PATTERNS.needsOneOf, {
      choices: choices.join(" / ")
    });
  }
  const required = new Map<string, number>();
  for (const ware of rule.inputs) required.set(ware, (required.get(ware) ?? 0) + 1);
  const missing: string[] = [];
  for (const [ware, amount] of required) {
    const ready = building.input[ware] ?? 0;
    if (ready >= amount) continue;
    missing.push(translateDomainMessage(i18n, DOMAIN_STATUS_PATTERNS.inputRequirement, {
      amount, incoming: building.incoming[ware] ?? 0, ready,
      ware: displayWareNameForCount(ware, amount, i18n)
    }));
  }
  return missing.length ? translateDomainMessage(i18n, DOMAIN_STATUS_PATTERNS.waitingForInputs, {
    missing: missing.join("; ")
  }) : building.status;
};

const BLOCKAGE_HINTS: Readonly<Record<string, keyof typeof DOMAIN_APP_MESSAGES.hints>> = {
  "Deposit exhausted": "depositEmpty",
  "No storage has room for another hand cart": "handcartRoom",
  "Output stock full": "outputFull",
  "Production orders complete": "ordersComplete",
  "Road not connected to storage": "connectStorage",
  "Waiting for a clear return route": "returnRoute",
  "Waiting for a clear sowing plot": "fieldSpace",
  "Waiting for a clear flax plot": "fieldSpace",
  "Waiting for cloth": "waitingCloth",
  "Waiting for construction supplies": "builderMaterials",
  "Waiting for reachable resource": "checkWorkArea",
  "Waiting for safe building access": "unsafeEntrance"
};

/** Settler growth as the rule runs it: the settler growth talent shortens the interval. */
const settlerWaitText = (growthBonus: number, i18n?: I18n) => {
  const suffix = growthBonus <= 0 ? "" : translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.talentChange, {
    percent: Math.round(growthBonus * 100), sign: "+"
  });
  return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.settlerWait, {
    seconds: Math.round(settlerGrowthSeconds(POPULATION_GROWTH_SECONDS, growthBonus)), suffix
  });
};

/** Advice from existing simulation evidence; no extra pathfinding or guessed traffic diagnosis. */
export const productionBlockageHint = (
  building: SettlementBuilding, nation: WorkerNation, availableSettlers?: number, populationFull = false,
  growthBonus = 0, i18n?: I18n
): string | null => {
  if (building.productionPaused)
    return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.productionPaused);
  if (building.status === "Waiting for reachable resource") {
    const materials = materialBuildingGroup(building.typeId);
    if (materials && isMaterialQuarry(building.typeId))
      return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.materialDeposit, {
        stone: displayMaterialName(materials.stone, i18n)
      });
    if (materials && isMaterialWoodcutter(building.typeId))
      return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.matureTree, {
        tree: displayMaterialName(materials.tree.replace("Tree", ""), i18n)
      });
  }
  const known = BLOCKAGE_HINTS[building.status];
  if (known) return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints[known]);
  if (building.status === "Waiting for inputs")
    return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.inputPolicy, {
      missing: productionWaitStatus(building, nation, i18n)
    });
  const rule = getBuildingProductionRule(building, nation);
  if (rule?.tool && building.status === `Waiting for ${rule.tool}`)
    return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.toolRequirement, {
      tool: displayWareName(rule.tool, i18n).toLowerCase()
    });
  if (!rule || building.construction !== 1 || building.worker !== undefined || availableSettlers !== 0) return null;
  if (populationFull) return translateDomainMessage(i18n, DOMAIN_APP_MESSAGES.hints.populationLimit);
  return settlerWaitText(growthBonus, i18n);
};

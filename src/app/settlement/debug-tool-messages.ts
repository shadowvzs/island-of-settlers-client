import type { I18n } from "@lingui/core";

import { HANDCART_LOGISTICS } from "../../shared/balance/economy";
import { translateDomainText } from "../../shared/i18n/domain";
import { translateMessage } from "../../shared/i18n/translate";
import type { DebugBuildingLevelResult } from "../../shared/settlement/settlement-debug-building-level";
import type { DebugEnemySpawn } from "../../shared/settlement/settlement-debug-enemy";
import type { DebugResetLogisticsReport } from "../../shared/settlement/settlement-debug-reset-logistics";
import type { DebugSoldierSpawn, DebugTroopGrant } from "../../shared/settlement/settlement-debug-troop";
import type { DebugBuildAllReport } from "./debug-build-all-runner";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import { troopName } from "./troop-names";

export interface DebugToolNotice {
  text: string;
  warning: boolean;
}

/** "Get a hand cart": where the carts went, or why none could be given. */
export const handcartGrantMessage = (granted: number, storageNames: readonly string[]): DebugToolNotice => {
  if (!granted) return { text: "No hand cart granted: every storage already keeps " +
    `${HANDCART_LOGISTICS.storageLimit} hand carts (carts on the road included).`, warning: true };
  const carts = granted === 1 ? "A hand cart" : `${granted} hand carts`;
  return { text: `${carts} added to the ${storageNames.join(", ")}.`, warning: false };
};

/** "Reset carriers": where they went and how much carried ware came with them. */
export const resetLogisticsMessage = (report: DebugResetLogisticsReport): DebugToolNotice => {
  if (!report.storages)
    return { text: "No carrier was reset: there is no completed storehouse on this island.", warning: true };
  if (!report.carriers) return { text: "No carriers needed storing.", warning: false };
  const carriers = report.carriers === 1 ? "1 carrier" : `${report.carriers} carriers`;
  const storages = report.storages === 1 ? "1 storehouse" : `${report.storages} storehouses`;
  const ware = report.ware ? ` ${report.ware} carried materials added to stock.` : "";
  return { text: `Stored ${carriers} in ${storages}.${ware}`, warning: false };
};

/** "Build every building": how many were raised and each skipped type with its reason. */
export const buildAllMessage = (
  { built, skipped }: DebugBuildAllReport, buildingName: (typeId: number) => string, i18n?: I18n
): DebugToolNotice => {
  const raised = translateMessage(i18n,
    built === 1 ? M.debug.buildAll.doneOne : M.debug.buildAll.done, { count: built });
  if (!skipped.length) return { text: raised, warning: false };
  const reasons = skipped.map(entry => translateMessage(i18n, M.debug.buildAll.skipItem, {
    building: buildingName(entry.typeId),
    reason: translateDomainText(entry.reason, i18n)
  })).join("; ");
  return {
    text: translateMessage(i18n,
      built === 1 ? M.debug.buildAll.skippedOne : M.debug.buildAll.skipped, { count: built, reasons }),
    warning: true
  };
};

/** "Spawn enemy on click": the soldier that appeared, or why none could. */
export const enemySpawnMessage = (spawn: DebugEnemySpawn | null, nation: string): DebugToolNotice => {
  if (!spawn) return { text: "No enemy spawned: no walkable ground your troops can reach near that point.",
    warning: true };
  return { text: `Enemy ${troopName(nation, spawn.type)} (rank ${spawn.rank + 1}) spawned.`, warning: false };
};

/** "Add a random military unit": the soldier who joined the home garrison, or why none could. */
export const troopGrantMessage = (grant: DebugTroopGrant | null, nation: string): DebugToolNotice => {
  if (!grant) return { text: "No soldier added: this island has no home building.", warning: true };
  return { text: `${troopName(nation, grant.type)} (rank ${grant.rank + 1}) added to the home garrison.`,
    warning: false };
};

/** "Spawn soldier on click": the friendly field soldier that appeared, or why none could. */
export const soldierSpawnMessage = (spawn: DebugSoldierSpawn | null, nation: string): DebugToolNotice => {
  if (!spawn) return { text: "No soldier spawned: choose clear, walkable ground.", warning: true };
  return { text: `${troopName(nation, spawn.type)} (rank ${spawn.rank + 1}) spawned at the clicked ground.`,
    warning: false };
};

/** "Raise building level": the level the clicked building reached, or why it could not rise. */
export const buildingLevelMessage = (
  result: DebugBuildingLevelResult, buildingName: (typeId: number) => string
): DebugToolNotice => {
  const name = result.typeId === undefined ? "Raise building level" : buildingName(result.typeId);
  if (!result.ok) return { text: `${name}: ${result.reason}.`, warning: true };
  return { text: `${name} raised to level ${result.level}.`, warning: false };
};

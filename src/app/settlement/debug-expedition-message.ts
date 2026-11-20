import type { I18n } from "@lingui/core";
import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";

import { COLONY_SUPPLY_SECONDS } from "../../shared/balance/colonies";
import { displayWareName, translateDomainText } from "../../shared/i18n/domain";
import { translateMessage } from "../../shared/i18n/translate";
import { isAdventureIsland } from "../../shared/settlement/adventure-rules";
import { colonyOreShipMs } from "../../shared/settlement/archipelago";
import type {
  DebugExpeditionGrant, DebugExpeditionKind, DebugExpeditionResult
} from "../../shared/settlement/settlement-debug-expeditions";
import type { Goods } from "../../shared/settlement/settlement-types";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";

const difficultyText = (difficulty: string, i18n?: I18n) => {
  if (difficulty === "easy") return translateMessage(i18n, M.debug.expedition.difficultyEasy);
  if (difficulty === "medium") return translateMessage(i18n, M.debug.expedition.difficultyMedium);
  return translateMessage(i18n, M.debug.expedition.difficultyHard);
};
const describeGoods = (goods: Goods, i18n?: I18n) => Object.entries(goods).map(([ware, count]) =>
  `${count} ${i18n ? displayWareName(ware, i18n).toLowerCase() : ware}`).join(", ");

/** Every grant the test needed, in plain words; empty when nothing was missing. */
export const describeDebugGrant = (granted: DebugExpeditionGrant, i18n?: I18n) => {
  const parts: string[] = [];
  if (granted.harbourPlaced) parts.push(translateMessage(i18n, M.debug.expedition.grantHarbour));
  if (granted.ships) parts.push(translateMessage(i18n,
    granted.ships === 1 ? M.debug.expedition.grantShipOne : M.debug.expedition.grantShips,
    { count: granted.ships }));
  if (granted.troops) parts.push(translateMessage(i18n,
    granted.troops === 1 ? M.debug.expedition.grantVeteranOne : M.debug.expedition.grantVeterans,
    { count: granted.troops }));
  if (granted.crew) parts.push(translateMessage(i18n,
    granted.crew === 1 ? M.debug.expedition.grantCrewOne : M.debug.expedition.grantCrew,
    { count: granted.crew }));
  const supplies = describeGoods(granted.supplies, i18n);
  if (supplies) parts.push(supplies);
  return parts.join(", ");
};

const timerSummary = (kind: DebugExpeditionKind, voyageSeconds: number, oreShipReduction = 0, i18n?: I18n) => {
  if (kind === "adventure")
    return translateMessage(i18n, M.debug.expedition.timerVoyage, { seconds: voyageSeconds });
  return translateMessage(i18n, M.debug.expedition.timerColony, {
    days: COLONY_LIFETIME_MS / 86_400_000,
    oreSeconds: colonyOreShipMs(oreShipReduction) / 1000,
    seconds: voyageSeconds,
    supplySeconds: COLONY_SUPPLY_SECONDS
  });
};

/** The settlement message for a development menu test expedition: what was granted and started, or why not. */
export const debugExpeditionMessage = (kind: DebugExpeditionKind, result: DebugExpeditionResult,
  oreShipReduction = 0, i18n?: I18n) => {
  const name = translateMessage(i18n,
    kind === "adventure" ? M.debug.expedition.nameAdventure : M.debug.expedition.nameColony);
  if (!result.ok)
    return { text: translateMessage(i18n, M.debug.expedition.failed, {
      name, reason: translateDomainText(result.reason, i18n)
    }), warning: true };
  const granted = describeDebugGrant(result.granted, i18n);
  const target = translateMessage(i18n, isAdventureIsland(result.island)
    ? M.debug.expedition.targetAdventure : M.debug.expedition.targetColony);
  const values = {
    arrival: translateMessage(i18n,
      kind === "adventure" ? M.debug.expedition.arrivalAdventure : M.debug.expedition.arrivalColony),
    difficulty: difficultyText(result.island.difficulty, i18n),
    grants: granted,
    island: result.island.name,
    name,
    target,
    timers: timerSummary(kind, result.island.voyageSeconds, oreShipReduction, i18n)
  };
  return {
    text: translateMessage(i18n, granted ? M.debug.expedition.started : M.debug.expedition.startedComplete, values),
    warning: false
  };
};

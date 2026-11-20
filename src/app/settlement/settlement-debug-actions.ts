import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { DiscoveryOverride } from "../../shared/settlement/island-discovery-policy";
import type { DebugExpeditionKind } from "../../shared/settlement/settlement-debug-expeditions";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { runDebugBuildAll } from "./debug-build-all-runner";
import { debugExpeditionMessage } from "./debug-expedition-message";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import {
  buildAllMessage, handcartGrantMessage, resetLogisticsMessage, troopGrantMessage
} from "./debug-tool-messages";
import type { PlayerSession } from "./player-session";

interface SettlementDebugContext {
  /** Owner 2026-10-15: online players get these actions only with an administrator role. */
  allowed: boolean;
  buildingName: (typeId: number) => string;
  /** Buildings already announced as complete; debug-raised ones join it silently. */
  completed: Set<number>;
  /** Active Lingui instance: debug tool notices follow the selected locale. */
  i18n?: I18n;
  message: (text: string, warning?: boolean) => void;
  onFocusBuilding?: (building: SettlementBuilding) => void;
  player?: PlayerSession;
  simulation: SettlementSimulation;
  updateUi: () => void;
}

/** Development menu actions of the live settlement; each reports its outcome as a message. */
export const createSettlementDebugActions = (context: SettlementDebugContext) => {
  const { allowed, buildingName, completed, i18n, message, player, simulation, updateUi } = context;
  if (!allowed) {
    const denied = () => message(translateMessage(i18n, M.debug.accessDenied), true);
    return {
      addDebugLevels: denied,
      buildEveryBuilding: denied,
      fillAllOutputs: denied,
      upgradeOwnedRoads: denied,
      grantCoins: denied,
      grantDebugTroop: denied,
      grantGems: denied,
      grantHandcarts: denied,
      resetCarriers: denied,
      startDebugExpedition: denied
    };
  }
  let buildAllRunning = false;
  return {
    /** Development menu: a colony or adventure expedition with everything granted and test timers. */
    startDebugExpedition: (kind: DebugExpeditionKind, override?: DiscoveryOverride) => {
      const result = simulation.startDebugExpedition(kind, override);
      const source = result.ok && simulation.colonyExpeditions().find(entry => entry.id === result.id)?.sourceUid;
      const harbour = simulation.buildings().find(building => building.uid === source);
      // A harbour raised by the test is part of its message, not a separate "complete" notice.
      if (harbour) { completed.add(harbour.uid); context.onFocusBuilding?.(harbour); }
      const notice = debugExpeditionMessage(kind, result,
        simulation.talentModifiers().colonyShipIntervalReduction, i18n);
      message(notice.text, notice.warning);
      updateUi();
    },
    /** Development menu: gems for testing the gem shop. */
    grantGems: (gems: number) => {
      if (!player) return;
      if (player.grantGems(gems)) message(`${gems} gems granted.`);
      else message("Signed in: gems come only from the server (an admin grant).", true);
      updateUi();
    },
    /** Development menu: the normal XP curve, capped at the final supported level. */
    addDebugLevels: () => {
      if (!player) return;
      const before = player.level(), after = player.addDebugLevels(10);
      message(after === before ? `Already at maximum player level ${after}.` : `Player level ${before} → ${after}.`);
      updateUi();
    },
    /** Development menu: gold coins into the home storage. */
    grantCoins: (coins: number) => {
      if (simulation.grantCoins(coins)) message(`${coins} gold coins added to the headquarters.`);
      updateUi();
    },
    /** Development menu: one finished, road-connected building of every type, in slices. */
    buildEveryBuilding: () => {
      if (simulation.colony() || simulation.home()?.colonyHome) {
        message("Build every building is disabled on colonies.", true); return;
      }
      if (buildAllRunning) return;
      buildAllRunning = true;
      message("Building every building...");
      runDebugBuildAll({
        onDone: report => {
          buildAllRunning = false;
          // The generated roads get the same flower verge a player could plant along them.
          simulation.debugPlantRoadVerges();
          const notice = buildAllMessage(report, buildingName, i18n);
          console.info(`[debug] ${notice.text}`);
          message(notice.text, notice.warning);
          updateUi();
        },
        // Raised buildings are part of the summary, not a "complete" notice each.
        onRaised: building => completed.add(building.uid),
        raise: function* (typeId) {
          for (;;) {
            const step = simulation.debugRaiseBuildingStep(typeId);
            if (step.done) return step.value;
            yield;
          }
        }
      });
    },
    /** Development menu: fill each owned producer's current output without crediting production. */
    fillAllOutputs: () => {
      const report = simulation.debugFillOutputs();
      const skipped = report.skipped.map(entry => `${buildingName(entry.typeId)} (${entry.reason})`);
      const detail = skipped.length ? ` Skipped: ${skipped.join("; ")}.` : "";
      message(`Added ${report.items} outputs to ${report.buildings} buildings.${detail}`);
      updateUi();
    },
    /** Development menu: each owned public road edge advances once on this island. */
    upgradeOwnedRoads: () => {
      const report = simulation.debugUpgradeRoads();
      message(translateMessage(i18n, M.debug.roadsUpgraded, { count: report.upgraded }));
      updateUi();
    },
    /** Development menu: one random soldier stored in the home building's garrison. */
    grantDebugTroop: () => {
      const notice = troopGrantMessage(simulation.grantDebugTroop(), simulation.playerNation());
      message(notice.text, notice.warning);
      updateUi();
    },
    /** Development menu: finished hand carts shelved at the nearest storages with room. */
    grantHandcarts: (count: number) => {
      const { granted, storages } = simulation.grantHandcarts(count);
      const names = simulation.buildings().filter(building => storages.includes(building.uid))
        .map(building => buildingName(building.typeId));
      const notice = handcartGrantMessage(granted, names);
      message(notice.text, notice.warning);
      updateUi();
    },
    /** Development menu: return all carriers and transport horses to the nearest completed storage. */
    resetCarriers: () => {
      const notice = resetLogisticsMessage(simulation.resetCarriers());
      message(notice.text, notice.warning);
      updateUi();
    }
  };
};

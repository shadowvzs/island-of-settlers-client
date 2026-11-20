import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementUi } from "../settlement-ui";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";
import type { IslandTravel } from "./island-settlement";
import type { PlayerSession } from "./player-session";

interface ExpeditionOutcomeOptions {
  getIslandTravel?: () => IslandTravel | undefined;
  getUi: () => SettlementUi | undefined;
  i18n?: I18n;
  message: (text: string, warning?: boolean) => void;
  player?: PlayerSession;
  simulation: SettlementSimulation;
}

/** Announces a colony's or adventure's victory or defeat once, when it happens (not on reload). */
export const createExpeditionOutcomeAnnouncer = (options: ExpeditionOutcomeOptions) => {
  const { i18n, message, simulation } = options;
  let colonyStatus = simulation.colony()?.status;
  /** Victory or defeat on a colony island opens one popup when it happens, not on reload. */
  const announceColonyOutcome = () => {
    const colony = simulation.colony(), previous = colonyStatus;
    colonyStatus = colony?.status;
    const id = options.getIslandTravel?.()?.active();
    if (!colony || previous !== "contested" || colony.status === "contested" || id == null) return;
    const experience = colony.status === "conquered"
      ? options.player?.colonyConquered(colony.island.difficulty) : undefined;
    options.getUi()?.announceColony(colony.status, colony.island, id, experience);
    message(colony.status === "conquered"
      ? translateMessage(i18n, M.status.colonyConquered, { island: colony.island.name })
      : translateMessage(i18n, M.status.colonyFailed), colony.status !== "conquered");
  };
  let adventureStatus = simulation.adventure()?.status;
  /** Victory pays experience at once (coins and wares sail home); either outcome opens one popup. */
  const announceAdventureOutcome = () => {
    const adventure = simulation.adventure(), previous = adventureStatus;
    adventureStatus = adventure?.status;
    if (!adventure || previous !== "contested" || adventure.status === "contested") return;
    const reward = adventure.status === "won" ? options.player?.adventureWon(adventure.island) : undefined;
    options.getUi()?.announceAdventure(adventure.status, adventure.island, reward);
    message(adventure.status === "won"
      ? translateMessage(i18n, M.status.adventureWon, { island: adventure.island.name })
      : translateMessage(i18n, M.status.adventureFailed), adventure.status !== "won");
  };
  return () => {
    announceColonyOutcome();
    announceAdventureOutcome();
  };
};

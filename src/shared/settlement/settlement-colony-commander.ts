import { colonyTroopCount, type ColonyTroops } from "./colony-expedition-rules";
import type { ColonyExpedition } from "./settlement-colony-expeditions";
import { COMMANDER_DECK_SLOTS } from "./settlement-commander-transport";
import type { SettlementContext } from "./settlement-types";

/** The outward commander's shared planner/readiness view. */
export const colonyCommanderStatus = (context: SettlementContext) => context.commander?.transportStatus();

export const colonyCommanderDetail = (context: SettlementContext) => {
  const status = colonyCommanderStatus(context);
  if (!status) return "No commander is available";
  return status.blockDetail ?? (status.ready ? null : "Commander is not ready for deployment");
};

export const colonyCommanderReason = (context: SettlementContext, commanderId: string | undefined) => {
  if (!commanderId) return null;
  const status = colonyCommanderStatus(context);
  if (!status) return "No commander is available at home";
  if (status.id !== commanderId) return "Commander identity does not match the roster";
  return status.ready ? null : colonyCommanderDetail(context);
};

/** A commander counts one unit toward the difficulty's troop cap. */
export const colonyCommanderCapReason = (
  troops: Partial<ColonyTroops>, commanderId: string | undefined, troopCap: number
) => commanderId && colonyTroopCount(troops) + 1 > troopCap
  ? "Troop limit exceeded for this difficulty with the commander"
  : null;

/** Gather, embark and board the manifested commander; true once the load may be queued. */
export const colonyCommanderMusterStep = (context: SettlementContext, expedition: ColonyExpedition) => {
  if (!expedition.commanderId) return true;
  const status = colonyCommanderStatus(context);
  if (!status || status.id !== expedition.commanderId) {
    expedition.commanderBlocked = "Commander is unavailable";
    return false;
  }
  if (status.phase === "reserved") {
    const muster = context.commander?.muster(expedition.id, expedition.sourceUid);
    if (!muster?.ok) {
      expedition.commanderBlocked = muster?.reason ?? "Commander cannot reach the harbour";
      return false;
    }
    expedition.commanderBlocked = undefined;
    return false;
  }
  if (status.phase === "muster") {
    expedition.commanderBlocked = "Commander mustering at the harbour";
    return false;
  }
  if (status.phase !== "waiting" && status.phase !== "aboard") {
    expedition.commanderBlocked = status.blockDetail ?? "Commander is not ready to board";
    return false;
  }
  expedition.commanderBlocked = undefined;
  return true;
};

export const colonyCommanderSnapshot = (
  expedition: ColonyExpedition, status: ReturnType<typeof colonyCommanderStatus>
) => status && expedition.commanderId ? {
  blockDetail: expedition.commanderBlocked ?? status.blockDetail,
  deckSlots: COMMANDER_DECK_SLOTS, hp: status.hp, id: status.id, level: status.level,
  maximumHp: status.maximumHp, name: status.name, phase: status.phase, xp: status.xp
} : undefined;

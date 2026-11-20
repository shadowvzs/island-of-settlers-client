import { militaryHealth } from "./military-combat-rules";
import type { CommanderSystem } from "./settlement-commander-state";
import type { EmigratedTroop, SettlementSoldier } from "./settlement-military";
import { countOnDuty } from "./settlement-population";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/** One soldier (with its commander manifest, if any) leaving the island as a naval receipt. */
export const emigrateTroop = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, commander: CommanderSystem,
  uid: number
): EmigratedTroop | null => {
  const soldier = soldiers.get(uid), actor = context.actors.find(entry => entry.uid === uid);
  if (!soldier || !actor) return null;
  const type = soldier.combat?.type ?? "shield";
  const commanderManifest = soldier.commanderId ? commander.detachForTransport() : null;
  if (soldier.commanderId && !commanderManifest) return null;
  const troop: EmigratedTroop = { hp: soldier.combat?.hp ?? militaryHealth(type, soldier.rank),
    rank: soldier.rank, type,
    ...(commanderManifest ? { commander: commanderManifest } : {}),
    ...(soldier.recoverySeconds !== undefined ? { recoverySeconds: soldier.recoverySeconds } : {}) };
  const leaving = new Set([uid, soldier.combat?.mount]);
  soldiers.delete(uid);
  context.actors.splice(0, context.actors.length, ...context.actors.filter(entry => !leaving.has(entry.uid)));
  if ((soldier.combat?.faction ?? 0) === 0) countOnDuty(context, -1);
  return troop;
};

/** Adopt each landed commander receipt exactly once after its ordinary soldier actor is recreated. */
export const adoptImmigratedCommanders = (
  context: SettlementContext, commander: CommanderSystem, troops: readonly EmigratedTroop[],
  actors: readonly SettlementActor[], placement: "adventure" | "colony" | "home"
) => troops.forEach((troop, index) => {
  const actor = actors[index];
  if (troop.commander && actor) commander.adopt(troop.commander, actor, placement);
});

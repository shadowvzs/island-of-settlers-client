import { secondsToTicks } from "../../../../island-of-settlers-shared/src/time/constants";
import { STRIKE_SECONDS } from "../balance/commander-roles";
import type { MoraleState } from "../balance/morale";
import { admitAiOrder } from "../script-world/script-order-guard";
import { createTargetingWeights } from "./commander/commander-focus";
import { createCommanderProfileSource } from "./commander/commander-profile-source";
import type { CommanderUnit } from "./commander/commander-types";
import { createMilitaryMorale, type MilitaryMorale } from "./commander/military-morale-update";
import type { CombatCore, FieldMemory } from "./settlement-combat-core";
import type { CombatOrders } from "./settlement-combat-orders";
import { COMBAT_PHASE } from "./settlement-combat-tick-inputs";
import type { TargetingPriorities } from "./settlement-combat-targeting";
import { isNavigationClear } from "./settlement-navigation";
import type { SettlementActor, SettlementContext } from "./settlement-types";
import { markTickPhase } from "./tick-phase-profile";

/** The tick phase of the morale update (A14-2), measured apart from the combat update and from its orders. */
export const MORALE_PHASE = "morale";
export const MORALE_MARCH_PHASE = "morale.march";

/** The targeting's A14-2 inputs: the enemy hero (from its active aura) and each faction's weights. */
export const createTargetingPriorities = (context: SettlementContext): TargetingPriorities => ({
  heroUid: () => context.commander?.aura()?.uid,
  weightsOf: createTargetingWeights(createCommanderProfileSource(context),
    () => context.commanderLevels?.revision() ?? 0)
});

/**
 * Field soldier morale wired to the combat layer: the hero's aura, the targeting's rescore clock, and the
 * ordinary `retreat` march for fall-backs and routs (script-held soldiers excluded, like every AI order).
 */
export const createCombatMorale = (
  core: CombatCore, tick: () => number, orders: Pick<CombatOrders, "march">, owns: (uid: number) => boolean
): MilitaryMorale => {
  const { context } = core;
  return createMilitaryMorale(core, {
    aura: () => context.commander?.aura(),
    directlyControlled: owns,
    isClear: point => isNavigationClear(context, point),
    retreat: (ids, point, faction) => {
      markTickPhase(MORALE_MARCH_PHASE);
      const accepted = orders.march(admitAiOrder(context, ids), point, faction, "retreat", false, false);
      markTickPhase(MORALE_PHASE);
      return accepted;
    },
    tick
  });
};

/** Runs the morale update as its own tick phase. */
export const updateMoralePhase = (morale: MilitaryMorale, entries: readonly SettlementActor[]) => {
  markTickPhase(MORALE_PHASE);
  morale.update(entries);
  markTickPhase(COMBAT_PHASE);
};

/** Debug overlay and fixtures: every field soldier that is not steady, `[uid, state]` (A14-2). */
export const moraleStatesOf = (memories: ReadonlyMap<number, FieldMemory>) => {
  const states: [number, MoraleState][] = [];
  for (const [uid, memory] of memories) if (memory.moraleState) states.push([uid, memory.moraleState]);
  return states;
};

/** A flank strike begins (A14-2): its soldiers ignore being outnumbered in their morale for `STRIKE_SECONDS`. */
export const grantStrikeGrace = (
  members: readonly CommanderUnit[], memoryOf: CombatCore["memoryOf"], tick: number
) => {
  const until = tick + secondsToTicks(STRIKE_SECONDS);
  for (const { uid } of members) memoryOf(uid).strikeGrace = until;
};

import { MILITARY_PROFILES } from "../../balance/military";
import { MORALE_BROKEN } from "../../balance/morale";
import { probeAccept } from "../faction-vision-probe";
import type { MilitaryTroopType } from "../military-combat-rules";
import type { CombatCore } from "../settlement-combat-core";
import type { SettlementActor } from "../settlement-types";
import { rankValueOf, strengthFrom } from "./commander-squads";

/** Health share left (`militaryHealth` with the cached rank worth: the deterministic power allocates). */
export const healthShare = (hp: number, type: MilitaryTroopType, rank: number) =>
  hp / (MILITARY_PROFILES[type].hp * rankValueOf(rank));

/**
 * This tick's field soldiers as the morale sweeps read them, built once on the first update of a tick: faction,
 * strength, broken and steady flags by entry index, and per deciding faction whether it knows each one (lazily,
 * probed once per faction, soldier and tick). No per-neighbour map lookups or allocations in the sweeps.
 */
export const createMoraleSnapshot = ({ isKnownEnemyOf, memories, soldiers }: CombatCore) => {
  const indexOf = new Map<number, number>();
  let entries: readonly SettlementActor[] = [];
  let factions = new Int32Array(64), strengths = new Float64Array(64);
  let broken = new Uint8Array(64), steady = new Uint8Array(64);
  const knownBy = new Map<number, Int8Array>(), knownTests = new Map<number, (body: SettlementActor) => boolean>();

  const grow = (count: number) => {
    if (factions.length >= count) return;
    factions = new Int32Array(count * 2);
    strengths = new Float64Array(count * 2);
    broken = new Uint8Array(count * 2);
    steady = new Uint8Array(count * 2);
  };
  const build = (list: readonly SettlementActor[]) => {
    entries = list;
    indexOf.clear();
    knownBy.clear();
    knownTests.clear();
    grow(list.length);
    list.forEach((body, index) => {
      const soldier = soldiers.get(body.uid), state = soldier?.combat;
      if (!soldier || !state) return;
      const moraleState = memories.get(body.uid)?.moraleState;
      indexOf.set(body.uid, index);
      factions[index] = state.faction;
      strengths[index] = strengthFrom(healthShare(state.hp, state.type, soldier.rank), state.type, soldier.rank,
        moraleState);
      broken[index] = moraleState === MORALE_BROKEN ? 1 : 0;
      steady[index] = moraleState ? 0 : 1;
    });
  };
  /** Whether `faction` knows the soldier at entry index `index`. */
  const knows = (faction: number, body: SettlementActor, index: number) => {
    let known = knownBy.get(faction), test = knownTests.get(faction);
    if (!known) knownBy.set(faction, known = new Int8Array(factions.length).fill(-1));
    if (!test) knownTests.set(faction, test = probeAccept("morale.enemy", faction, isKnownEnemyOf(faction)));
    if (known[index] === -1) known[index] = test(body) ? 1 : 0;
    return known[index] === 1;
  };
  /** Visits `faction`'s own soldiers and the enemies it knows now, in entry order. */
  const forEachKnown = (faction: number, visit: (body: SettlementActor, index: number) => void) => {
    entries.forEach((body, index) => {
      if (!indexOf.has(body.uid)) return;
      if (factions[index] === faction || knows(faction, body, index)) visit(body, index);
    });
  };
  return {
    build,
    entries: () => entries,
    forEachKnown,
    indexOf: (uid: number) => indexOf.get(uid),
    isBroken: (index: number) => broken[index] === 1,
    isSteady: (index: number) => steady[index] === 1,
    factionAt: (index: number) => factions[index]!,
    knows,
    strengthAt: (index: number) => strengths[index]!
  };
};

export type MoraleSnapshot = ReturnType<typeof createMoraleSnapshot>;

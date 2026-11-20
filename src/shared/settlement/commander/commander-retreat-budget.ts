import { RETREAT_BUDGET } from "../../balance/military";
import type { CommanderAction, CommanderUnit, SquadView } from "./commander-types";
import { REGROUP_CONTACT } from "./commander-utility";

/**
 * Retreat budget of the commander's squads: seconds each soldier has spent retreating since enemies
 * last left it alone. A squad that used up `RETREAT_BUDGET` while still pressed turns and fights.
 */
export const createRetreatBudget = () => {
  const retreating = new Map<number, number>();
  return {
    /** The squad's mean retreat time has reached the budget. */
    spent: (squad: readonly CommanderUnit[]) => {
      let sum = 0;
      for (const unit of squad) sum += retreating.get(unit.uid) ?? 0;
      return sum / squad.length >= RETREAT_BUDGET;
    },
    /** Retreat time adds up while the squad retreats under threat and is forgotten once it is calm. */
    record: (
      squad: readonly CommanderUnit[],
      action: CommanderAction,
      view: SquadView,
      decisionInterval: number
    ) => {
      const calm = view.threat === 0 && view.enemyDistance > REGROUP_CONTACT;
      for (const unit of squad) {
        if (calm) retreating.delete(unit.uid);
        else if (action === "retreat")
          retreating.set(unit.uid, (retreating.get(unit.uid) ?? 0) + decisionInterval);
      }
    },
    /** Drops soldiers no longer in the field. */
    keep: (present: ReadonlySet<number>) => {
      for (const uid of retreating.keys()) if (!present.has(uid)) retreating.delete(uid);
    },
    save: (): [number, number][] => [...retreating],
    restore: (saved: readonly [number, number][] | undefined) => {
      retreating.clear();
      for (const [uid, time] of saved ?? []) retreating.set(uid, time);
    },
    clear: () => retreating.clear()
  };
};

export type RetreatBudget = ReturnType<typeof createRetreatBudget>;

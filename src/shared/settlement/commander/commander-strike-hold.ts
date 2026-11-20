import { STRIKE_REACH, STRIKE_SECONDS } from "../../balance/commander-roles";
import type { PositionChooser } from "./commander-position-choice";
import { centreOf } from "./commander-squads";
import type { CommanderAction, CommanderUnit, RoleGroupMemory, SquadMemory } from "./commander-types";

/** A squad's retreat with its striking flank group held out of it (reused lists, valid until the next call). */
export interface StrikeHold {
  /** The members that take the squad's order (all of them when nothing is held). */
  retreating: readonly CommanderUnit[];
  /** The striking group's memory for this decision (absent: nothing held). */
  group?: RoleGroupMemory;
}

/**
 * A14-2 flank strike: a flank group that is striking the enemy's archers stays out of its squad's retreat for at
 * most `STRIKE_SECONDS`, while an enemy archer is within `STRIKE_REACH` of it. Morale still wins: wavering and
 * broken soldiers are not the commander's at all.
 */
/**
 * A flank group that walked away from its squad (a squad of its own, keeping the squad memory) keeps attacking
 * while its walk or strike lasts (`STRIKE_SECONDS` of strike) and an enemy archer is within `STRIKE_REACH`: a
 * flank on its way does not stop to defend or regroup.
 */
export const isCommittedFlank = (
  squad: readonly CommanderUnit[], memory: SquadMemory | undefined, interval: number,
  hasPreyNear: PositionChooser["hasPreyNear"]
) => {
  const type = squad[0]!.type;
  if (memory?.action !== "attack" || squad.some((unit) => unit.type !== type)) return false;
  const group = memory.groups?.find((entry) => entry.type === type && entry.role === "flank");
  if (!group?.point || (group.strike ?? 0) * interval > STRIKE_SECONDS) return false;
  return hasPreyNear(centreOf(squad), STRIKE_REACH);
};

export const createStrikeHold = (chooser: Pick<PositionChooser, "hasPreyNear">) => {
  const retreating: CommanderUnit[] = [],
    strikers: CommanderUnit[] = [];
  const hold: StrikeHold = { retreating };
  const strikingGroupOf = (memory: SquadMemory | undefined, interval: number) => {
    const group = memory?.groups?.find((entry) => entry.role === "flank" && entry.strike !== undefined);
    return group && group.strike! * interval <= STRIKE_SECONDS ? group : undefined;
  };
  return (
    squad: readonly CommanderUnit[], action: CommanderAction, memory: SquadMemory | undefined, interval: number
  ): Readonly<StrikeHold> => {
    retreating.length = 0;
    strikers.length = 0;
    hold.group = undefined;
    const group = action === "retreat" ? strikingGroupOf(memory, interval) : undefined;
    for (const unit of squad) (group && unit.type === group.type ? strikers : retreating).push(unit);
    if (!group || !strikers.length || !chooser.hasPreyNear(centreOf(strikers), STRIKE_REACH)) {
      retreating.push(...strikers);
      return hold;
    }
    hold.group = { ...group, age: Math.min(255, group.age + 1), strike: group.strike! + 1 };
    return hold;
  };
};

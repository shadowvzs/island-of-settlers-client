/** Soldiers aboard (or held for) a ship: on a naval order, so neither selectable nor recalled (P4). */
export const isAboardShip = (actor: { navalOrder?: number }) => actor.navalOrder !== undefined;

/** A control group's number badge on the rail: the digit, its soldiers ashore and those aboard a ship. */
export interface ArmyGroupBadge {
  /** Members aboard (or walking aboard) a ship: a recall skips them, so `count` leaves them out. */
  aboard: number;
  count: number;
  digit: number;
}

/**
 * Client-only soldier control groups (military controls §7): digit → soldier actor ids. They are UI state,
 * not part of the save or the simulation; they live for the island session and are dropped on reload.
 */
export const createArmyControlGroups = () => {
  const groups = new Map<number, Set<number>>();
  /** Replaces the group; an empty selection deletes it. */
  const assign = (digit: number, ids: readonly number[]) => {
    if (!ids.length) { groups.delete(digit); return; }
    groups.set(digit, new Set(ids));
  };
  /** The group's soldiers that `canSelect` accepts now (stored or garrisoned soldiers stay in the group). */
  const recall = (digit: number, canSelect: (id: number) => boolean) =>
    [...groups.get(digit) ?? []].filter(canSelect);
  /** Drops soldiers that no longer exist (fallen); an emptied group disappears. True on a change. */
  const prune = (alive: ReadonlySet<number>) => {
    let changed = false;
    for (const [digit, ids] of groups) {
      for (const id of ids) if (!alive.has(id)) { ids.delete(id); changed = true; }
      if (!ids.size) groups.delete(digit);
    }
    return changed;
  };
  /** The rail badges, by digit; members `isAboard` accepts are counted apart. */
  const badges = (isAboard: (id: number) => boolean = () => false): ArmyGroupBadge[] =>
    [...groups].sort(([first], [second]) => first - second).map(([digit, ids]) => {
      let aboard = 0;
      for (const id of ids) if (isAboard(id)) aboard++;
      return { aboard, count: ids.size - aboard, digit };
    });
  return { assign, badges, clear: () => groups.clear(), prune, recall };
};

export type ArmyControlGroups = ReturnType<typeof createArmyControlGroups>;

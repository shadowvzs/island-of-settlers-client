import type { CombatCore } from "./settlement-combat-core";

/**
 * Troop ships (MIL-SHIPS-SIM): own field soldiers leave the field at an anchored ship's gangway foot and come
 * back to it when they walk down a gangway. Combat bookkeeping (orders, targets, sieges, marches) ends with them.
 */
export const createCombatShipPassage = ({ actorById, pendingMarches, sieges, soldiers }: CombatCore,
  forgetField: (uid: number) => void) => ({
  /** A field soldier becomes a naval passenger; a dismounted rider (horse waiting beside it) cannot. */
  leaveFieldForShip: (id: number) => {
    const soldier = soldiers.get(id), state = soldier?.combat, body = actorById(id);
    if (!soldier || !state || !body || state.faction !== 0 || body.phase !== "militaryField" ||
      sieges.isDefender(id) || state.dismounted) return false;
    sieges.cancel(id);
    pendingMarches.delete(id);
    Object.assign(state, { destination: undefined, pendingRoute: undefined, pendingTarget: undefined,
      returnStorageUid: undefined, returnToStorage: undefined, siege: undefined, target: undefined });
    forgetField(id);
    soldier.building = -1;
    soldier.stationed = false;
    return true;
  },
  /** A soldier walking off a troop ship's gangway is a battlefield soldier again (no storage home). */
  landFromShip: (id: number) => {
    const soldier = soldiers.get(id);
    if (!soldier) return false;
    soldier.building = -3;
    soldier.stationed = false;
    return true;
  }
});

import { type MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementActor } from "../../shared/settlement/settlement-types";
import type { ScreenBox } from "../worker-selection";
import {
  isOnScreen, isSelectableSoldierBody, nearestSoldierAt, type ScreenPoint, SOLDIER_CHEST_HEIGHT,
  soldiersInBox
} from "./army-selection";

type Project = (x: number, y: number, z: number) => ScreenPoint;
/** Where a double tap looks for soldiers of the tapped type: the visible map, or the whole island. */
export type TroopTypeScope = "island" | "screen";

/**
 * The player's soldier selection: the selected actor ids, which soldiers may be picked and the recorded
 * `selectMilitary` publication. Every change publishes once; hover never publishes.
 */
export const createMilitarySelection = (options: {
  conquered: () => boolean;
  project: Project;
  simulation: SettlementSimulation;
  /** The map viewport size in CSS pixels (the "on screen" test of a double tap). */
  viewport: () => { height: number; width: number };
}) => {
  const { simulation } = options;
  const selected = new Set(simulation.militarySoldiers().filter(soldier =>
    soldier.combat?.selected && soldier.combat.faction === 0).map(soldier => soldier.actor));
  const publish = () => simulation.selectMilitary([...selected]);
  const playerSoldiers = () => new Set(simulation.militarySoldiers()
    .filter(soldier => (soldier.combat?.faction ?? 0) === 0).map(soldier => soldier.actor));
  /** The player's soldiers outside: in the field, leaving, besieging or walking back to storage. */
  const selectableBodies = () => {
    if (options.conquered()) return [];
    const own = playerSoldiers();
    return simulation.frames().filter(actor => actor.job === "Soldier" && own.has(actor.uid) &&
      isSelectableSoldierBody(actor));
  };
  /** Soldiers the rail counts: selectable bodies plus the player's stationed garrison soldiers. */
  const rosterSoldiers = () => {
    const actors = new Map(simulation.frames().map(actor => [actor.uid, actor]));
    return simulation.militarySoldiers().filter(soldier => {
      const actor = actors.get(soldier.actor);
      if (!actor || (soldier.combat?.faction ?? 0) !== 0) return false;
      return isSelectableSoldierBody(actor) || (soldier.stationed && actor.phase === "garrison");
    });
  };
  const troopTypeById = () =>
    new Map(simulation.militarySoldiers().map(soldier => [soldier.actor, soldier.combat?.type ?? "shield"]));
  const selectTroopTypes = (chosen: readonly MilitaryTroopType[]) => {
    selected.clear();
    const types = troopTypeById();
    for (const actor of selectableBodies())
      if (chosen.includes(types.get(actor.uid) ?? "shield")) selected.add(actor.uid);
  };
  /** Every selectable soldier: the select-all hotkey. Publishes once. */
  const selectAll = () => {
    selected.clear();
    for (const actor of selectableBodies()) selected.add(actor.uid);
    publish();
  };
  /** Replaces the selection with these ids (a control-group recall). Publishes once. */
  const replace = (ids: readonly number[]) => {
    selected.clear();
    for (const id of ids) selected.add(id);
    publish();
  };
  /** A double tap: the tapped soldier's troop type, on screen or island-wide; added to or replacing the set. */
  const selectTypeOf = (uid: number, scope: TroopTypeScope, additive: boolean) => {
    const types = troopTypeById();
    const type = types.get(uid);
    if (!type) return 0;
    if (!additive) selected.clear();
    const viewport = options.viewport();
    const onScreen = (actor: SettlementActor) =>
      isOnScreen(options.project(actor.x, actor.y + SOLDIER_CHEST_HEIGHT, actor.z), viewport);
    let count = 0;
    for (const actor of selectableBodies()) {
      if (types.get(actor.uid) !== type) continue;
      if (scope === "screen" && !onScreen(actor)) continue;
      selected.add(actor.uid); count++;
    }
    publish();
    return count;
  };
  const addBox = (box: ScreenBox) => {
    for (const id of soldiersInBox(selectableBodies(), options.project, box)) selected.add(id);
  };
  /** The selectable soldier under a screen point, without selecting it. */
  const soldierAt = (point: ScreenPoint) => nearestSoldierAt(selectableBodies(), options.project, point)?.uid;
  /** Selects the soldier at the point and returns it; undefined (after clearing a single selection) for none. */
  const clickSelect = (point: ScreenPoint, multiple: boolean) => {
    const nearest = nearestSoldierAt(selectableBodies(), options.project, point);
    if (!nearest) {
      if (!multiple) { selected.clear(); publish(); }
      return undefined;
    }
    if (!multiple) selected.clear();
    if (multiple && selected.has(nearest.uid)) selected.delete(nearest.uid);
    else selected.add(nearest.uid);
    publish();
    return nearest.uid;
  };
  /** Drops soldiers that left the roster (fallen, stored, aboard); publishes only on a change. */
  const prune = (available: ReadonlySet<number>) => {
    let changed = false;
    for (const id of selected) if (!available.has(id)) { selected.delete(id); changed = true; }
    if (changed) publish();
  };
  const clear = () => { selected.clear(); publish(); };
  return {
    addBox,
    clear,
    clickSelect,
    ids: () => [...selected],
    prune,
    publish,
    replace,
    rosterSoldiers,
    selectAll,
    selectableBodies,
    selectTroopTypes,
    selectTypeOf,
    selected: selected as ReadonlySet<number>,
    soldierAt
  };
};

export type MilitarySelection = ReturnType<typeof createMilitarySelection>;

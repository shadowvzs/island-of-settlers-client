import type { I18n, MessageDescriptor, Values } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { isDoubleTap, type ScreenPoint, type SoldierTap } from "../army-selection";
import type { MilitarySelection } from "../military-selection";
import { createArmyControlGroups } from "./control-groups";
import { ARMY_SELECTION_MESSAGES as M } from "./messages";

interface SelectionCommandOptions {
  i18n?: I18n;
  message: (message: string, error?: boolean) => void;
  now?: () => number;
  /** The selection or the groups changed: refresh the rail. */
  onChange: () => void;
  selection: MilitarySelection;
}

/**
 * Soldier selection beyond a single tap (military controls P2, §7): the double tap on a troop type, select-all
 * and the client-only control groups. Every selection change publishes one recorded `selectMilitary`.
 */
export const createArmySelectionCommands = (options: SelectionCommandOptions) => {
  const { selection } = options;
  const now = options.now ?? (() => performance.now());
  const groups = createArmyControlGroups();
  let lastTap: SoldierTap | null = null;
  const say = (descriptor: MessageDescriptor, values?: Values, error = false) =>
    options.message(translateMessage(options.i18n, descriptor, values), error);

  /**
   * A selection tap; true when it hit a soldier. A second tap on a soldier within the double-tap window selects
   * that soldier's whole troop type on screen (Ctrl: island-wide), replacing the set unless `multiple`.
   */
  const tap = (point: ScreenPoint, event: { ctrlKey?: boolean }, multiple: boolean) => {
    const next = { ...point, time: now() };
    const tapped = selection.soldierAt(point);
    if (tapped !== undefined && isDoubleTap(lastTap, next)) {
      lastTap = null;
      const count = selection.selectTypeOf(tapped, event.ctrlKey ? "island" : "screen", multiple);
      say(M.selectedType, { count });
      options.onChange();
      return true;
    }
    const hit = selection.clickSelect(point, multiple);
    lastTap = hit === undefined ? null : next;
    options.onChange();
    return hit !== undefined;
  };
  const selectAll = () => {
    selection.selectAll();
    if (!selection.selected.size) say(M.noSoldiers, undefined, true);
    options.onChange();
  };
  /** Shift + digit: the group becomes the current selection (an empty selection clears it). */
  const assignGroup = (digit: number) => {
    const ids = selection.ids();
    groups.assign(digit, ids);
    if (ids.length) say(M.groupAssigned, { count: ids.length, digit });
    else say(M.groupCleared, { digit });
    options.onChange();
  };
  /** Digit: one recorded selection of the group's soldiers that are on the map now. */
  const recallGroup = (digit: number) => {
    const selectable = new Set(selection.selectableBodies().map(actor => actor.uid));
    const ids = groups.recall(digit, id => selectable.has(id));
    if (!ids.length) { say(M.groupEmpty, { digit }, true); return; }
    selection.replace(ids);
    options.onChange();
  };
  return {
    assignGroup,
    groups,
    recallGroup,
    selectAll,
    tap
  };
};

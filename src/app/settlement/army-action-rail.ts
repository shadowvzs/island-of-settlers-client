import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import { createLazyReactContent } from "../components/lazy-react-content";
import { createExternalStore, isShallowEqual } from "../components/ui-store";
import type { ArmyGroupBadge } from "./army-groups/control-groups";
import {
  type ArmyAction, type ArmyOrder, type ArmyRailState, getChosenTypes, INITIAL_ARMY_RAIL_STATE, toTroopCounts
} from "./army-rail/helpers";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";

import "./army-action-rail.css";

export { troopTypes } from "./army-icons";

/** React loads once the main thread is idle (at the latest after this), off the island loading path. */
const MOUNT_TIMEOUT_MS = 2000;

export interface ArmyActionRailOptions {
  /** Active Lingui instance: the rail's accessible labels follow the selected locale. */
  i18n?: I18n;
  onAction: (action: ArmyAction) => void;
  onAdd: (active: boolean) => void;
  onCancelRally?: () => void;
  /** Calls the chosen free troops to the planted rally banner. */
  onGather: (types: MilitaryTroopType[]) => void;
  /** The player picks the place where the rally banner is planted (or moved). */
  onRally: (types: MilitaryTroopType[]) => void;
  /** A control-group badge was clicked: select that group. */
  onRecallGroup: (digit: number) => void;
  onSelectTypes?: (types: MilitaryTroopType[]) => void;
}

/** The rail's callbacks for the React view; each one is a direct controller call. */
export type ArmyRailActions = ReturnType<typeof createRailActions>;

const createRailActions = (
  options: ArmyActionRailOptions, read: () => ArmyRailState, publish: (changes: Partial<ArmyRailState>) => void
) => {
  /** The add-to-selection mode and a pending order exclude each other (each owns the map click). */
  const setAdding = (adding: boolean) => {
    if (read().adding === adding) return;
    publish({ adding });
    options.onAdd(adding);
  };
  const closeRally = () => publish({ rallyOpen: false });
  return {
    closeRally,
    setAdding,
    onAction: options.onAction,
    onCancelRally: () => { closeRally(); options.onCancelRally?.(); },
    onChooseRallyPoint: () => { closeRally(); options.onRally(getChosenTypes(read())); },
    onGather: () => {
      const types = getChosenTypes(read());
      if (!types.length) return;
      closeRally();
      options.onGather(types);
    },
    onRecallGroup: options.onRecallGroup,
    onToggleAdding: () => setAdding(!read().adding),
    onToggleRally: () => {
      const rallyOpen = !read().rallyOpen;
      publish({ rallyOpen });
      if (rallyOpen) options.onSelectTypes?.(getChosenTypes(read()));
    },
    onToggleType: (type: MilitaryTroopType) => {
      const { checked } = read();
      publish({ checked: { ...checked, [type]: !checked[type] } });
      options.onSelectTypes?.(getChosenTypes(read()));
    }
  };
};

const scheduleWhenIdle = (callback: () => void) => {
  if ("requestIdleCallback" in window) requestIdleCallback(callback, { timeout: MOUNT_TIMEOUT_MS });
  else setTimeout(callback, MOUNT_TIMEOUT_MS);
};

/**
 * Soldier action rail: orders, add-to-selection mode, rally banner and troop type panel. State and
 * actions stay here (the military controller calls `setOrder` / `update` / `close`); the React view
 * renders a store snapshot and mounts into `root` when the main thread is first idle.
 */
export const createArmyActionRail = (options: ArmyActionRailOptions) => {
  const root = document.createElement("aside");
  root.className = "army-action-rail";
  const heading = () => translateMessage(options.i18n, M.military.actions.heading);
  const applyHeading = () => root.setAttribute("aria-label", heading());
  applyHeading();
  const stopLocale = options.i18n?.on("change", applyHeading);
  const store = createExternalStore<ArmyRailState>(INITIAL_ARMY_RAIL_STATE);
  const publish = (changes: Partial<ArmyRailState>) => {
    const next = { ...store.getSnapshot(), ...changes };
    if (!isShallowEqual(next, store.getSnapshot())) store.set(next);
  };
  const actions = createRailActions(options, store.getSnapshot, publish);
  const view = createLazyReactContent(root, heading(), async () =>
    (await import("./army-rail/mount")).createArmyRailMount(store, actions), {
    error: () => translateMessage(options.i18n, M.military.actions.loadFailed),
    loading: () => translateMessage(options.i18n, M.military.actions.loading)
  });
  let disposed = false;
  scheduleWhenIdle(() => { if (!disposed) view.mount(); });
  return {
    root,
    setOrder: (order: ArmyOrder) => {
      if (order) actions.setAdding(false);
      publish({ order });
    },
    close: () => { actions.closeRally(); actions.setAdding(false); },
    /** The control-group badges; republished only when a digit or a count changed. */
    setGroups: (groups: readonly ArmyGroupBadge[]) => {
      const current = store.getSnapshot().groups;
      const same = current.length === groups.length &&
        current.every((badge, index) => isShallowEqual(badge, groups[index]!));
      if (!same) publish({ groups });
    },
    update: (selected: number, nation: string,
      free: readonly { type: MilitaryTroopType; count: number }[], canEnter = true, hasBanner = false) => {
      const counts = toTroopCounts(free);
      const current = store.getSnapshot();
      publish({
        canEnter, free: isShallowEqual(counts, current.free) ? current.free : counts, hasBanner, nation, selected
      });
    },
    dispose: () => { stopLocale?.(); disposed = true; view.unmount(); }
  };
};

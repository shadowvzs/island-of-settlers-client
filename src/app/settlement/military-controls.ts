import type { I18n } from "@lingui/core";

import { setPrimaryDragSelects, setShiftDragSelects } from "../../render-common/camera-input-mode";
import type { ArmyTargetHoverOutline } from "../../render-common/renderer-contract";
import { translateMessage } from "../../shared/i18n/translate";
import { type MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementPoint } from "../../shared/settlement/settlement-types";
import { createMapToolCancel } from "../map-tool-cancel";
import { hotkeySettings } from "../settings/hotkeys/bindings";
import type { ShipTargetMode } from "../settlement-ui/ship-register/troop-types";
import { getWindowLayer } from "../window-layer";
import { createArmyActionRail } from "./army-action-rail";
import { createArmyBoxSelect } from "./army-box-select";
import { isAboardShip } from "./army-groups/control-groups";
import { createArmyFirstUseTip } from "./army-groups/first-use-tip";
import { ARMY_SELECTION_MESSAGES } from "./army-groups/messages";
import { createArmySelectionCommands } from "./army-groups/selection-commands";
import { troopTypes } from "./army-icons";
import { applyArmyCursor, type ArmyCursorMode, getArmyCursorMode } from "./army-order-cursor";
import type { ArmyAction, ArmyOrder } from "./army-rail/helpers";
import { armedOrderTone, armyTargetCursor, type ArmyTargetModifiers, routeRightTap } from "./army-target/helpers";
import { createArmyOrderMarker } from "./army-target/order-marker";
import { type ArmyQueueWaypointOptions, createArmyQueueWaypoints } from "./army-target/queue-waypoints";
import { armyTargetOutline, createArmyTargetHover } from "./army-target/target-hover";
import { createArmyTargetOrders } from "./army-target/target-orders";
import { ARMY_ORDER_PROMPTS, ARMY_RAIL_ISOLATED_EVENTS } from "./constants";
import type { DebugClickModeControls } from "./debug-click-modes";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";
import type { MapHoverPick } from "./map-hover-pick";
import { setToolDisabled } from "./military-debug/helpers";
import { createMilitaryDebugTools } from "./military-debug-tools";
import { type MilitaryKeyCommand, militaryKeyCommand, needsSelection } from "./military-hotkeys";
import { createMilitaryOrderDispatch } from "./military-order-dispatch";
import { createMilitarySelection } from "./military-selection";
import { armyHoverCursor } from "./ship-orders/helpers";
import { createShipTroopOrders } from "./ship-orders/ship-troop-orders";

/** The right-side soldier rail is meaningful only with at least one soldier on this island. */
export const shouldShowMilitaryRail = (soldierCount: number, conquered: boolean) =>
  !conquered && soldierCount > 0;

export interface MilitaryControlsOptions {
  /** False during a session transition: selection stays, no order or rally command runs. */
  canCommand?: () => boolean;
  /** The Development panel's map-click modes, for the soldier-spawn button. */
  debugClick?: Pick<DebugClickModeControls, "setSoldierSpawnMode" | "soldierSpawnMode" | "watchSoldierSpawnMode">;
  /** The shared map hover: with it, a mouse hover shows the soldiers' target cursor and outline (P3). */
  hover?: MapHoverPick;
  hudRoot?: HTMLElement;
  /** Live sight (fog): enemies and enemy buildings under fog are no right-click targets. */
  isVisible: (point: SettlementPoint) => boolean;
  /** Active Lingui instance: rail labels and development tool copy follow the selected locale. */
  i18n?: I18n;
  mount: HTMLElement;
  /** The map canvas: selection boxes start only on it, never on a panel. */
  surface?: HTMLElement;
  simulation: SettlementSimulation;
  project: (x: number, y: number, z: number) => { x: number; y: number };
  pick: (x: number, y: number) => SettlementPoint | null;
  pickBuilding?: (x: number, y: number) => string | null;
  pickShip?: (x: number, y: number) => string | null;
  /** Right-click targets: the building the left-click chain would open at the point. */
  pickTargetBuilding: (x: number, y: number) => SettlementBuilding | undefined;
  /** Outlines the hover target through the renderer's hover outlines (null: the renderer's own hover). */
  setTargetOutline?: (outline: ArmyTargetHoverOutline | null) => void;
  /** The Shift-queue waypoint display's terrain height and depth-aware projection (absent: no waypoints). */
  waypoints?: Pick<ArmyQueueWaypointOptions, "groundHeight" | "project">;
  /** Placement, a debug click mode or another map tool owns the keys and Shift + drag (§8 precedence). */
  toolActive?: () => boolean;
  message: (message: string, error?: boolean) => void;
}

/**
 * The soldier rail, selection and orders: composes the selection (taps, groups, select-all), the armed-order
 * dispatcher, the smart right-click orders, the target hover and the development tools, and owns the rail, box
 * select, cursor and the hotkey / Escape / right-press arbitration.
 */
export const createMilitaryControls = (options: MilitaryControlsOptions) => {
  const { simulation } = options;
  const events = new AbortController();
  const conquered = () => simulation.colony()?.status === "conquered";
  const canAct = () => (options.canCommand?.() ?? true) && !conquered();
  const surface = options.surface ?? options.mount;
  const selection = createMilitarySelection({ conquered, project: options.project, simulation,
    viewport: () => ({ height: surface.clientHeight, width: surface.clientWidth }) });
  const existingHud = options.hudRoot ?? options.mount.querySelector<HTMLElement>(".settlement-ui");
  const hud = existingHud ?? document.createElement("div");
  if (!existingHud) { hud.className = "settlement-ui"; getWindowLayer(options.mount).append(hud); }
  const root = document.createElement("div"); root.className = "military-controls";

  let order: ArmyOrder = null;
  let adding = false;
  let railShown = false;
  let hoverMode: ArmyCursorMode | null = null;
  let rallyTypes: MilitaryTroopType[] = [...troopTypes];
  const orders = createMilitaryOrderDispatch({ ...options, rallyTypes: () => rallyTypes, selection });
  const marker = createArmyOrderMarker(options.mount);
  const targetOrders = createArmyTargetOrders({ ...options, marker, selection });
  const waypoints = options.waypoints && createArmyQueueWaypoints({ ...options.waypoints, mount: options.mount,
    selected: () => selection.selected, simulation });
  const showTip = createArmyFirstUseTip(() =>
    options.message(translateMessage(options.i18n, ARMY_SELECTION_MESSAGES.firstUseTip)));
  const syncCursor = () => applyArmyCursor(surface, getArmyCursorMode(order, adding,
    armyHoverCursor(selection.selected.size, hoverMode, ships.cursorMode())));
  /** The ship whose window is open: its right tap and the panel's target modes (§9.3). */
  const ships = createShipTroopOrders({ ...options, marker, onChange: () => syncCursor() });
  const hoverActive = () => railShown && !order && !adding && selection.selected.size > 0 && canAct();
  const targetHover = options.hover && createArmyTargetHover({ ...options, active: hoverActive, hover: options.hover,
    selection,
    onTarget: target => {
      hoverMode = target && armyTargetCursor(target);
      options.setTargetOutline?.(target && armyTargetOutline(target));
      syncCursor();
    } });
  const setOrder = (next: ArmyOrder) => { order = next; rail.setOrder(next); syncCursor(); targetHover?.refresh(); };
  const setAdding = (active: boolean) => {
    adding = active; setPrimaryDragSelects(active); boxSelect.setActive(active);
    if (active && order) setOrder(null);
    syncCursor(); targetHover?.refresh();
  };
  /** Soldiers aboard a ship, for the group badges: read once per update, and only when a group asks. */
  const aboardShip = () => {
    let aboard: Set<number> | undefined;
    return (id: number) =>
      (aboard ??= new Set(simulation.frames().filter(isAboardShip).map(actor => actor.uid))).has(id);
  };
  const commands = createArmySelectionCommands({ ...options, onChange: () => update(), selection });
  const gatherAtBanner = (types: MilitaryTroopType[]) => {
    const count = simulation.callOutMilitary(types);
    options.message(count ? `${count} soldiers called to the rally banner.` : "No free troops of the chosen types.");
    update();
  };
  const returnHome = () => {
    setOrder(null);
    const ids = selection.ids();
    const returning = simulation.returnMilitaryHome(ids);
    if (!returning && simulation.storyLockedSoldiers(ids).length) {
      options.message(translateMessage(options.i18n, M.military.storyLocked));
      return;
    }
    options.message(returning ? "Soldiers returning to their closest reachable storehouse."
      : "No reachable storehouse for this selection.");
  };
  const armOrder = (action: Exclude<ArmyAction, "return">) => {
    setOrder(action);
    options.message(ARMY_ORDER_PROMPTS[action]);
  };
  const rail = createArmyActionRail({
    i18n: options.i18n,
    onSelectTypes: chosen => { selection.selectTroopTypes(chosen); selection.publish(); update(); },
    onCancelRally: () => { simulation.cancelMilitaryRally(); setOrder(null); update(); },
    onAction: action => { if (action === "return") returnHome(); else armOrder(action); },
    onAdd: setAdding,
    onGather: gatherAtBanner,
    onRally: types => {
      rallyTypes = types; setOrder("rally");
      options.message("Choose where to plant the rally banner. The called troops march there.");
    },
    onRecallGroup: digit => { if (canAct()) commands.recallGroup(digit); }
  });
  const boxSelect = createArmyBoxSelect({
    element: options.mount, surface,
    onSelect: box => { selection.addBox(box); selection.publish(); update(); }
  });
  const debugTools = createMilitaryDebugTools({ ...options, onChange: () => update() });
  /** Hides the rail and drops every soldier-control mode (no soldier, or the island fell). */
  const hideRail = () => {
    setOrder(null); rail.close();
    if (simulation.militaryRally()) simulation.cancelMilitaryRally();
    boxSelect.setActive(false); setPrimaryDragSelects(false);
    if (selection.selected.size) selection.clear();
    commands.groups.clear(); rail.setGroups([]);
  };
  const update = () => {
    const conqueredNow = conquered();
    railShown = shouldShowMilitaryRail(simulation.militarySoldiers().length, conqueredNow);
    root.hidden = !railShown;
    // The development panel's training tool must remain available to create the first soldiers.
    debugTools.hidden.set(conqueredNow);
    ships.refresh();
    if (!railShown) { hideRail(); waypoints?.refresh(); targetHover?.refresh(); syncCursor(); return; }
    setToolDisabled(debugTools.training, simulation.militaryTrainingStarted());
    // A soldier selection takes precedence over the ship: it ends an armed ship target mode (§9.3).
    if (selection.selected.size) ships.cancel();
    const eligible = selection.rosterSoldiers();
    selection.prune(new Set(eligible.map(soldier => soldier.actor)));
    commands.groups.prune(new Set(simulation.militarySoldiers().map(soldier => soldier.actor)));
    rail.setGroups(commands.groups.badges(aboardShip()));
    const canEnter = eligible.some(soldier =>
      selection.selected.has(soldier.actor) && soldier.combat?.type !== "cavalry");
    const nation = simulation.playerNation();
    rail.update(selection.selected.size, nation, simulation.militaryFreeTroops(), canEnter,
      !!simulation.militaryRally());
    showTip(selection.selected.size);
    waypoints?.refresh();
    targetHover?.refresh();
    syncCursor();
  };
  /** The armed order at the click: accepted ends it, a refusal keeps it armed for another try. */
  const chooseOrder = (armed: Exclude<ArmyOrder, null>, x: number, y: number) => {
    const accepted = orders.dispatch(armed, x, y);
    marker.show({ x, y }, armedOrderTone(armed, accepted));
    if (accepted) { setOrder(null); update(); }
    return true;
  };
  /**
   * A right tap / long-press: the armed order wins for this one tap, else the smart order (§6). Box-select mode
   * takes no order: on a phone its still press is a long-press (P0/P1 open point).
   */
  const orderAt = (x: number, y: number, modifiers?: ArmyTargetModifiers) => {
    const armed = order;
    if (adding || !canAct()) return false;
    const route = routeRightTap(armed, selection.selected.size);
    if (route === "none") return ships.order(x, y);
    if (armed) return chooseOrder(armed, x, y);
    targetOrders(x, y, modifiers);
    update();
    return true;
  };
  const keysAllowed = () => railShown && canAct() && !options.toolActive?.();
  const runKeyCommand = (command: MilitaryKeyCommand) => {
    if (command.kind === "arm") armOrder(command.order);
    else if (command.kind === "return") returnHome();
    else if (command.kind === "selectAll") commands.selectAll();
    else if (command.key.assign) commands.assignGroup(command.key.digit);
    else commands.recallGroup(command.key.digit);
  };
  /**
   * Army hotkeys and control-group digits act only in the iso view with no tool owning the keys. Escape cancels
   * the armed order first, else clears the selection, but only when no window, popup, placement or tool took this
   * Escape. Decided after the whole dispatch, so listener order is irrelevant.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    const command = keysAllowed() ? militaryKeyCommand(event, hotkeySettings.getSnapshot()) : null;
    if (command && (!needsSelection(command) || selection.selected.size)) {
      event.preventDefault();
      runKeyCommand(command);
      return;
    }
    if (event.key !== "Escape") return;
    window.setTimeout(() => {
      if (events.signal.aborted || event.defaultPrevented) return;
      rail.close();
      if (order) { setOrder(null); return; }
      if (!selection.selected.size) return;
      selection.clear(); update();
    }, 0);
  };
  root.append(rail.root); hud.append(root);
  for (const type of ARMY_RAIL_ISOLATED_EVENTS)
    root.addEventListener(type, event => event.stopPropagation(), { signal: events.signal });
  window.addEventListener("keydown", onKeyDown, { signal: events.signal });
  // Shift + left drag boxes soldiers on every device while the rail shows and no tool owns the map (§4.3).
  setShiftDragSelects(keysAllowed);
  update();
  const cancel = () => {
    setOrder(null); setAdding(false); rail.close(); ships.cancel();
    selection.clear();
  };
  /** A ship panel target mode: the soldier selection and its armed order end first (one owner of the map). */
  const armShip = (shipId: string, mode: ShipTargetMode) => {
    if (!canAct()) return;
    setOrder(null); setAdding(false);
    if (selection.selected.size) { selection.clear(); update(); }
    ships.arm(shipId, mode);
  };
  // Right press cancels box-select mode; an armed order instead takes the next right tap (§6).
  const stopCancellation = createMapToolCancel({ active: () => adding, cancel: () => setAdding(false), surface });
  const stopShipCancellation = createMapToolCancel({ active: () => ships.armed() !== null, cancel: ships.cancel,
    surface });
  return {
    cancel,
    debugControls: debugTools.controls,
    update,
    click: (x: number, y: number, event?: Pick<PointerEvent, "ctrlKey" | "shiftKey">) => {
      if (!canAct()) return false;
      if (ships.click(x, y)) return true;
      if (order) return chooseOrder(order, x, y);
      return commands.tap({ x, y }, event ?? {}, adding || !!event?.shiftKey);
    },
    order: orderAt,
    /** The ship window's selection and the troop panel's target modes. */
    ships: { arm: armShip, armed: ships.armed, cancel: ships.cancel, select: ships.select, selected: ships.selected },
    dispose: () => {
      stopCancellation(); stopShipCancellation(); ships.dispose(); marker.dispose(); waypoints?.dispose();
      targetHover?.dispose(); options.setTargetOutline?.(null);
      events.abort(); boxSelect.dispose(); setPrimaryDragSelects(false); setShiftDragSelects(null);
      applyArmyCursor(surface, null); rail.dispose(); root.remove();
      if (!existingHud) hud.remove();
    }
  };
};

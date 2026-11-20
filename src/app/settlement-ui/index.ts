import { translateMessage } from "../../shared/i18n/translate";
import { talentModifiers } from "../../shared/progression/talents";
import type { SurveyJob } from "../../shared/settlement/settlement-surveying";
import { createReactHost } from "../components/window/helpers";
import { createMultiboardLayer } from "../script/multiboard/multiboard-layer";
import { getWindowLayer } from "../window-layer";
import { createBridgePanel } from "./bridge-details/bridge-panel";
import { createBuildingDetailsWindow } from "./building-details/building-details-window";
import { getBuildingDetailsTitle } from "./building-details/helpers";
import { createSettlementBuildingRegisterWindow } from "./building-register/building-register-window";
import { createCampaignWindow } from "./campaign-window/campaign-window-frame";
import { CAMPAIGN_WINDOW_MESSAGES } from "./campaign-window/messages";
import { adventureOutcomePopup, colonyOutcomePopup } from "./colony-announcements";
import { createColonyTracker } from "./colony-tracker/colony-tracker";
import { createDemolishConfirmWindow } from "./demolish-confirm-window";
import { createAdventurePlannerWindow, createColonyPlannerWindow } from "./expedition-planner/planner-window";
import { createGemShopWindow } from "./gem-shop/gem-shop-window";
import type { LauncherId } from "./hud/helpers";
import { createSettlementHudLoader } from "./hud/hud-loader";
import { levelUpPopup } from "./level-up-popup";
import type { MenuEntryId } from "./main-panel/helpers";
import { createMainPanel } from "./main-panel/main-panel";
import { createMarketWindow } from "./market/market-window";
import { SETTLEMENT_MESSAGES as M } from "./messages";
import { createMessageWindow } from "./messages/message-window";
import { createQuestWindow } from "./quests/quest-window";
import { createSettlementScriptWindows } from "./script-windows";
import { createSettlementPopup } from "./settlement-popup";
import { createSettlementShipWindow } from "./ship-register/ship-register-window";
import { createSettlementSummaryWindow } from "./summary/summary-window";
import { SUPPORT_MESSAGES } from "./support/messages";
import { createSupportWindow } from "./support/support-window";
import { createTalentsWindow } from "./talents/talents-window";
import { createTradeOfficeWindow } from "./trade-office/trade-office-window";
import type { SettlementRoadMode, SettlementUi, SettlementUiOptions, SettlementUiSnapshot } from "./types";
import { createSettlementUiStore } from "./ui-store";

import "./player-hud.css";
import "./styles.css";

export type {
  SettlementAdventureSummary,
  SettlementBuildingSummary,
  SettlementColonySummary,
  SettlementNotification,
  SettlementRoadMode,
  SettlementShipSummary,
  SettlementUi,
  SettlementUiOptions,
  SettlementUiSnapshot
} from "./types";

/**
 * Settlement HUD and windows: simulation remains with the caller; no private UI inventory or game clock.
 * React-free controllers own visibility; React frames drag and raise them and render the snapshot store.
 */
export const createSettlementUi = (options: SettlementUiOptions): SettlementUi => {
  const root = document.createElement("div");
  const i18n = options.i18n;
  const t = (descriptor: Parameters<typeof translateMessage>[1], values?: Parameters<typeof translateMessage>[2]) =>
    translateMessage(i18n, descriptor, values);
  root.className = "settlement-ui";
  const events = new AbortController();
  const { signal } = events;
  /** One immutable snapshot per update; React windows select from it, DOM views read `state`. */
  const store = createSettlementUiStore();
  let state = store.getSnapshot();
  const patch = (partial: SettlementUiSnapshot) => {
    const changed = store.update(partial);
    state = store.getSnapshot();
    return changed;
  };
  let published = false;
  const summaryWindow = createSettlementSummaryWindow(store, i18n);
  const focusBuild = () =>
    root.querySelector<HTMLButtonElement>(".settlement-ui__actions .settlement-ui__button--primary")?.focus();
  const mainPanel = createMainPanel({ isBuildBlocked: () => state.buildingMenuBlocked === true });
  const clearModes = () => {
    options.onSelectBuilding(null);
    options.onRoadMode(null);
    options.onSurveyJob?.(null);
  };
  const cancelMode = () => {
    clearModes();
    update({ selectedBuilding: null, roadMode: null, surveyJob: null });
  };
  const pickBuilding = (id: number) => {
    if (state.buildingMenuBlocked) return;
    options.onRoadMode(null);
    options.onSurveyJob?.(null);
    options.onSelectBuilding(id);
    update({ buildHighlight: "", selectedBuilding: id, roadMode: null, surveyJob: null });
    // Phones hide the picker after a choice to make space for placing on the map.
    if (window.innerWidth < 640) mainPanel.hide();
  };
  const shipWindow = createSettlementShipWindow({ i18n, observation: options.shipObservation,
    preview: options.shipDeckPreview, troops: options.shipTroops, onLocate: options.onFocusShip,
    onSink: options.onSinkShip });
  const colonyPlanner = createColonyPlannerWindow(store, options);
  const adventurePlanner = createAdventurePlannerWindow(store, options);
  const popup = createSettlementPopup(i18n);
  const questWindow = createQuestWindow(store, options);
  const messageWindow = createMessageWindow(store, options);
  const supportWindow = createSupportWindow(i18n);
  const gemShop = createGemShopWindow(store, options);
  const marketWindow = createMarketWindow(store, options.market, i18n);
  const talentsWindow = createTalentsWindow(store, options);
  /** Campaign departures (C8): only when the session provides them; the launcher shows on the home island. */
  const campaignWindow = options.campaign && createCampaignWindow(store, options.campaign, i18n);
  /** Harbour market (TRADE-01): only when the session provides the island's trade office. */
  const tradeOffice = options.trade && createTradeOfficeWindow(store, options.trade, i18n);
  /**
   * Trading is for the home island only (owner rule): no colony or adventure island on screen, and only while the
   * island's rules keep the trade office on (GS4a; the window closes when they switch it off).
   */
  const isTradeIsland = () => state.activeColony == null && (state.features?.trade ?? "on") === "on";
  const colonyTracker = createColonyTracker(store, options, popup.show, i18n);
  /** Script multiboards (TRG8): an empty hidden layer until the map script shows a board; below the tracker. */
  const multiboards = createMultiboardLayer(colonyTracker.root);
  const panelOptions = { ...options, onOpenColonyPlanner: options.onStartColony && colonyPlanner.openFor,
    onOpenAdventurePlanner: options.onStartAdventure && adventurePlanner.openFor,
    onOpenTradeOffice: tradeOffice && (() => { if (isTradeIsland()) tradeOffice.open(); }) };
  const focusShip = (id: string | number) => shipWindow.focus(String(id));
  const demolishWindow = createDemolishConfirmWindow(uid => {
    if (!options.onDemolishBuilding?.(uid)) return;
    patch({ focusedBuilding: null });
    detailsWindow.close();
  }, i18n);
  const detailsWindow = createBuildingDetailsWindow(store, {
    ...panelOptions,
    onDemolishBuilding: options.onDemolishBuilding && ((uid) => {
      const building = state.buildings?.find(candidate => candidate.id === String(uid));
      if (building) demolishWindow.request(building);
      return false;
    }),
    onFocusBuilding: (id) => focusBuilding(id)
  }, () => {
    patch({ focusedBuilding: null });
    options.onCloseBuilding?.();
  });
  const registerWindow = createSettlementBuildingRegisterWindow(store, id => focusBuilding(id), i18n);
  /** The bridge panel shares the details frame; one subject's details are shown at a time. */
  const bridgePanel = createBridgePanel(store, options, partial => { patch(partial); });
  const focusBridge = (id: number) => {
    detailsWindow.close();
    bridgePanel.focus(id);
  };
  /**
   * Only own buildings open their details (owner 2026-10-21); hostile ones show a hover tooltip. `focus` is the
   * player's selection (recorded `select` + camera) or, for a map script, the camera only (rev M16).
   */
  const showBuildingDetails = (id: string | number, focus = options.onFocusBuilding) => {
    if (state.buildings?.some(candidate => candidate.id === String(id) && candidate.hostile)) return;
    bridgePanel.close();
    patch({ focusedBuilding: String(id) });
    focus?.(String(id));
    const building = state.buildings?.find(candidate => candidate.id === state.focusedBuilding);
    detailsWindow.setTitle(getBuildingDetailsTitle(building, state.playerNation, i18n));
    demolishWindow.sync(state.focusedBuilding, state.buildings, state.playerNation);
    detailsWindow.open();
  };
  const focusBuilding = (id: string | number) => showBuildingDetails(id);
  /** Script details focus: refused silently when the building is gone or hostile. */
  const focusBuildingDetails = (uid: number) => {
    if (!state.buildings?.some(candidate => candidate.id === String(uid) && !candidate.hostile)) return false;
    showBuildingDetails(uid, options.onFocusBuildingCamera);
    return true;
  };
  const setRoad = (mode: Exclude<SettlementRoadMode, null>) => {
    if (state.buildingMenuBlocked) return;
    const next = state.roadMode === mode ? null : mode;
    options.onSelectBuilding(null);
    options.onSurveyJob?.(null);
    options.onRoadMode(next);
    update({ selectedBuilding: null, roadMode: next, surveyJob: null });
  };
  const toggleSurvey = (job: SurveyJob) => {
    const selected = state.surveyJob === job ? null : job;
    options.onSelectBuilding(null);
    options.onRoadMode(null);
    options.onSurveyJob?.(selected);
    mainPanel.hide();
    update({ selectedBuilding: null, roadMode: null, surveyJob: selected });
  };
  /** The level-up's Build button: the picker opens on the first new building's category, cards marked. */
  const openBuildFor = (types: readonly number[]) => {
    patch({ buildHighlight: types.join(","), buildHighlightRevision: (state.buildHighlightRevision ?? 0) + 1 });
    if (!mainPanel.isShowing("build")) mainPanel.open("build");
  };
  const launchers: Readonly<Record<LauncherId, (opener?: HTMLElement) => void>> = {
    build: () => mainPanel.open("build"),
    campaign: () => { if (state.homeIsland) campaignWindow?.open(); },
    inventory: opener => options.onOpenInventory?.(opener),
    map: options.onMinimap,
    menu: () => mainPanel.open("menu"),
    news: () => mainPanel.open("notices"),
    support: () => supportWindow.open()
  };
  const menuEntries: Readonly<Record<MenuEntryId, () => void>> = {
    buildings: () => {
      options.onOverview?.();
      shipWindow.update(state.ships, state.playerNation);
      registerWindow.open();
    },
    market: () => {
      mainPanel.hide();
      marketWindow.open();
    },
    overview: summaryWindow.open,
    settings: () => {
      mainPanel.hide();
      options.onSettings();
    },
    ships: () => {
      options.onShips?.();
      mainPanel.open("ships");
    }
  };
  const hudHost = createReactHost(), mainPanelHost = createReactHost();
  hudHost.classList.add("settlement-ui__hud-host");
  /** Player corner, status, placement strip, bar and launchers, main panel: one React root, loaded late. */
  const hud = createSettlementHudLoader({
    actions: {
      canCampaign: Boolean(campaignWindow),
      canSurvey: Boolean(options.onSurveyJob),
      /** The main panel's Ships view (fleet orders and ship rows) loads with React on its first opening. */
      loadFleet: async () =>
        (await import("./fleet/mount")).createFleetMount(store, panelOptions, mainPanel.visibility, focusShip),
      menuShortcuts: options.menuShortcuts ?? [],
      onCancelPlacement: cancelMode,
      onClosePanel: () => {
        mainPanel.hide();
        focusBuild();
      },
      onFocusBuilding: id => focusBuilding(id),
      onHomeSandbox: enabled => { options.onHomeSandbox?.(enabled); },
      onLauncher: (id, opener) => launchers[id](opener),
      onMenuEntry: id => menuEntries[id](),
      onOpenMessages: () => messageWindow.open(),
      onOpenQuests: () => questWindow.open(),
      onOpenShop: () => gemShop.open(),
      onOpenTalents: () => talentsWindow.open(),
      onPickBuilding: pickBuilding,
      onRoadTool: setRoad,
      onRotate: options.onRotate,
      onSurveyJob: toggleSurvey
    },
    hosts: { hud: hudHost, mainPanel: mainPanelHost },
    panel: mainPanel.visibility,
    store
  });
  root.append(mainPanelHost, summaryWindow.root, registerWindow.root, detailsWindow.root, bridgePanel.root,
    shipWindow.root,
    colonyPlanner.root, adventurePlanner.root, colonyTracker.root, multiboards.root, questWindow.root,
    messageWindow.root,
    gemShop.root, marketWindow.root, talentsWindow.root, demolishWindow.root, supportWindow.root, hudHost,
    popup.root);
  if (tradeOffice) root.insertBefore(tradeOffice.root, demolishWindow.root);
  if (campaignWindow) root.insertBefore(campaignWindow.root, demolishWindow.root);
  /** The windows Escape closes (after any placement mode) and dispose tears down, in this order. */
  const escapeWindows: readonly { close: () => void; dispose: () => void }[] = [
    summaryWindow, registerWindow, detailsWindow, bridgePanel, shipWindow, colonyPlanner, adventurePlanner,
    questWindow,
    messageWindow, supportWindow, gemShop, marketWindow, talentsWindow, ...(tradeOffice ? [tradeOffice] : []),
    ...(campaignWindow ? [campaignWindow] : [])
  ];
  /** Presentation modes close every ordinary settlement window without cancelling map drafts. */
  const closeWindows = () => {
    for (const entry of escapeWindows) entry.close();
    mainPanel.hide();
    demolishWindow.close();
    popup.close();
  };
  for (const event of ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"])
    root.addEventListener(event, (event) => event.stopPropagation(), { signal });
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      // A focused popup owns Escape: close only that popup, as its document listener would.
      if (!popup.root.hidden && popup.root.contains(event.target as Node)) {
        popup.close();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (state.selectedBuilding !== null || state.roadMode !== null || state.surveyJob != null)
        cancelMode();
      else {
        mainPanel.hide();
        for (const entry of escapeWindows) entry.close();
        focusBuild();
      }
      event.preventDefault();
      event.stopPropagation();
    },
    { signal }
  );
  const update = (snapshot: SettlementUiSnapshot) => {
    // Nothing changed (e.g. a repeated status): the DOM views already show this snapshot.
    if (!patch(snapshot) && published) return;
    published = true;
    if (state.buildingMenuBlocked) {
      if (mainPanel.isShowing("build")) mainPanel.hide();
      if (state.selectedBuilding != null || state.roadMode != null || state.surveyJob != null) {
        clearModes();
        patch({ selectedBuilding: null, roadMode: null, surveyJob: null });
      }
    }
    shipWindow.update(state.ships, state.playerNation);
    if (tradeOffice?.isOpen() && !isTradeIsland()) tradeOffice.close();
    if (campaignWindow?.isOpen() && !state.homeIsland) campaignWindow.close();
    demolishWindow.sync(state.focusedBuilding, state.buildings, state.playerNation);
    bridgePanel.sync();
  };
  /** DOM-created frames (titles, tracker labels) follow the locale without remounting their content. */
  const refreshCopy = () => {
    summaryWindow.setTitle(t(M.summary.title));
    registerWindow.setTitle(t(M.register.title));
    shipWindow.setTitle(t(M.shipRegister.title));
    questWindow.setTitle(t(M.quests.title));
    messageWindow.setTitle(t(M.messages.title));
    supportWindow.setTitle(t(SUPPORT_MESSAGES.title));
    gemShop.setTitle(t(M.gemShop.title));
    marketWindow.setTitle(t(M.market.title));
    talentsWindow.setTitle(t(M.talents.title));
    colonyPlanner.setTitle(t(M.planner.titleColony));
    adventurePlanner.setTitle(t(M.planner.titleAdventure));
    if (tradeOffice) tradeOffice.setTitle(t(M.trade.title));
    if (campaignWindow) campaignWindow.setTitle(t(CAMPAIGN_WINDOW_MESSAGES.title));
    detailsWindow.setTitle(getBuildingDetailsTitle(
      state.buildings?.find(building => building.id === state.focusedBuilding), state.playerNation, i18n));
    demolishWindow.refreshTitle();
    bridgePanel.refreshTitle();
    colonyTracker.refreshLabels();
  };
  const unsubscribeLocale = i18n?.on("change", refreshCopy);
  getWindowLayer(options.mount ?? document.querySelector<HTMLElement>("#viewport") ?? document.body).append(root);
  update({});
  const scriptWindows = createSettlementScriptWindows({ colonyPlanner: options.onStartColony && colonyPlanner,
    colonyTracker, detailsWindow, gemShop, mainPanel, marketWindow, messageWindow, questWindow,
    snapshot: () => state, summaryWindow, talentsWindow, tradeAllowed: isTradeIsland, tradeOffice,
    focusBuildingDetails });
  return {
    closeWindows,
    root,
    scriptWindows,
    announceColony: (outcome, island, id, experience) => popup.show(colonyOutcomePopup(outcome, island,
      state.playerNation ?? "roman", { experience, onDisband: options.onDisbandColony &&
        (() => options.onDisbandColony!(id)), onReturnHome: options.onReturnHome,
      oreShipReduction: talentModifiers(state.player?.talents).colonyShipIntervalReduction }, i18n)),
    announceAdventure: (outcome, island, reward) =>
      popup.show(adventureOutcomePopup(outcome, island, state.playerNation ?? "roman", reward,
        options.onReturnHome, i18n)),
    announceLevelUp: levelUps =>
      popup.show(levelUpPopup(levelUps, state.playerNation, openBuildFor, i18n)),
    focusBridge,
    focusBuilding,
    focusShip,
    onIslandShown: hud.onIslandShown,
    showPopup: popup.show,
    update,
    dispose: () => {
      unsubscribeLocale?.();
      events.abort();
      hud.dispose();
      for (const entry of escapeWindows) entry.dispose();
      demolishWindow.dispose();
      colonyTracker.dispose();
      multiboards.dispose();
      popup.dispose();
      root.remove();
    }
  };
};

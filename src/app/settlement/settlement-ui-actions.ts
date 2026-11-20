import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { CHOOSE_NATION_OFFER_ID } from "../../shared/progression/player-inventory";
import { adventureRewardFor, adventureRewardGoods } from "../../shared/settlement/adventure-rules";
import { withHomeSandbox } from "../../shared/settlement/building-availability-rules";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { settleCommand } from "../components/helpers";
import { INVENTORY_MESSAGES } from "../player-inventory/messages";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";
import type { SettlementUiOptions } from "../settlement-ui/types";
import type { IslandTravel } from "./island-settlement";
import type { PlayerSession } from "./player-session";
import type { createShipDemo } from "./ship-demo";
import { showTutorialTarget } from "./tutorial-navigation";

/** Settlement status line/notification sink shared by the island controller. */
type SettlementMessage = (text: string, warning?: boolean, building?: SettlementBuilding) => void;

interface SettlementActionContext {
  i18n?: I18n;
  message: SettlementMessage;
  simulation: SettlementSimulation;
  updateUi: () => void;
}

const getTransitionRefusal = (i18n?: I18n) => translateMessage(i18n, M.actions.transition);
const COMMAND_QUERIES = new Set(["onExpeditionTargets", "onPotentialSettlements", "onPlanAdventure", "onPlanColony"]);
const COMMAND_REFUSALS = new Set(["onStartAdventure", "onStartColony"]);
const PLAYER_REFUSALS = new Set(["onApplyTalents", "onBuyGemOffer", "onCompleteQuest", "onResetTalents",
  "onSkipTutorial"]);
const PLAYER_COMMANDS = new Set([...PLAYER_REFUSALS, "onDisbandColony", "onReadMessage", "onRecallColonySoldiers",
  "onReturnCommander", "onReturnHome", "onVisitColony"]);

/** Blocks only command callbacks: queries and window/selection actions stay usable during a transition. */
const guardActions = <T extends object>(actions: T, canRun: () => boolean, blocked: (name: string) => unknown,
  names?: ReadonlySet<string>): T => {
  const guarded: Record<string, unknown> = {};
  for (const [name, action] of Object.entries(actions)) {
    if (typeof action !== "function" || (names && !names.has(name))) { guarded[name] = action; continue; }
    guarded[name] = (...args: unknown[]) => canRun()
      ? (action as (...args: unknown[]) => unknown)(...args)
      : blocked(name);
  }
  return guarded as T;
};

const commandRefusal = (name: string, i18n?: I18n) => {
  if (name === "onExpeditionTargets" || name === "onPotentialSettlements") return [];
  if (COMMAND_QUERIES.has(name)) return undefined;
  if (COMMAND_REFUSALS.has(name)) return getTransitionRefusal(i18n);
  return false;
};

/** While a session transition runs, new settlement commands report a refusal instead of mutating the world. */
export const guardCommandActions = <T extends object>(actions: T, canRun: () => boolean, i18n?: I18n) =>
  guardActions(actions, canRun, name => commandRefusal(name, i18n));

/** Player and colony commands wait for the transition; reward queries and window focus stay available. */
export const guardPlayerActions = <T extends object>(actions: T, canRun: () => boolean, i18n?: I18n) =>
  guardActions(actions, canRun,
    name => PLAYER_REFUSALS.has(name) ? getTransitionRefusal(i18n) : undefined, PLAYER_COMMANDS);

type SettlementCommandActions = Pick<SettlementUiOptions, "onCancelColony" | "onCancelSeaTransport" | "onSinkShip" |
  "onCommanderLevelUp" | "onDemolishBuilding" | "onExpeditionTargets" | "onPotentialSettlements" |
  "onGarrisonComposition" |
  "onCatapultAmmo" | "onFisherMode" | "onMilitaryCoins" | "onMilitaryTrainingFocus" | "onPlanAdventure" | "onPlanColony" | "onProductionMode" |
  "onProductionOrder" |
  "onProductionPaused" | "onQueueExpedition" | "onQueueExploration" | "onQueuePassengers" | "onQueueTransport" |
  "onRecruitCommander" | "onReturnCommander" |
  "onSawmillMode" | "onShipyardMode" | "onStartAdventure" | "onStartColony" |
  "onHomeSandbox" | "onStorageCollect" | "onTavernRecruit" | "onWorkshopUpgrade">;

interface SettlementCommandContext extends SettlementActionContext {
  /** Why the shared operation slot refuses a colony or adventure launch (archipelago side); null when free. */
  operationBlock?: () => string | null;
  onBuildingDemolished: () => void;
}

/**
 * The archipelago half of the operation slot (contested colonies, filed adventures, a campaign run) is not
 * simulation state, so it is checked before the recorded command: a refused launch is never recorded.
 */
const refuseBlockedLaunch = (context: SettlementCommandContext) => {
  const blocked = context.operationBlock?.();
  if (!blocked) return null;
  context.message(blocked, true);
  context.updateUi();
  return blocked;
};

/** Building, sea, military and expedition commands: each reports its result and refreshes the HUD. */
export const createSettlementCommandActions = (context: SettlementCommandContext): SettlementCommandActions => {
  const { i18n, message, onBuildingDemolished, simulation, updateUi } = context;
  return {
    onShipyardMode: (uid, mode) => { const result = simulation.setShipyardMode(uid, mode); updateUi(); return result; },
    onSawmillMode: (uid, mode) => { const result = simulation.setSawmillMode(uid, mode); updateUi(); return result; },
    onFisherMode: (uid, mode) => { const result = simulation.setFisherMode(uid, mode); updateUi(); return result; },
    onSinkShip: id => { const result = simulation.sinkShip(Number(id)); updateUi(); return result; },
    onCancelSeaTransport: id => { const result = simulation.cancelSeaTransport(id); updateUi(); return result; },
    onQueuePassengers: (source, destination, helpers, soldiers) => {
      const result = simulation.queueSeaPassengers(source, destination, helpers, soldiers);
      message(translateMessage(i18n,
        result === null ? M.actions.passengerRefused : M.actions.passengerQueued), result === null);
      updateUi(); return result !== null;
    },
    onExpeditionTargets: source => simulation.seaExpeditionDestinations(source),
    onPotentialSettlements: source => simulation.seaPotentialSettlements(source),
    onQueueExploration: source => {
      const result = simulation.queueSeaExploration(source);
      message(translateMessage(i18n,
        result === null ? M.actions.explorationRefused : M.actions.explorationQueued), result === null);
      updateUi(); return result !== null;
    },
    onQueueExpedition: (source, target) => {
      const result = simulation.queueSeaExpedition(source, target);
      let expeditionMessage = translateMessage(i18n, M.actions.expeditionQueued);
      if (result === null) expeditionMessage = translateMessage(i18n, M.actions.expeditionInvalid);
      else if (result < 0) expeditionMessage = translateMessage(i18n, M.actions.expeditionPreparing);
      message(expeditionMessage, result === null);
      updateUi(); return result !== null;
    },
    onMilitaryTrainingFocus: (uid, focus) => {
      const result = simulation.setMilitaryTrainingFocus(uid, focus); updateUi(); return result;
    },
    onRecruitCommander: (uid, definitionId) => {
      const result = simulation.recruitCommander(uid, definitionId);
      message(result.ok ? translateMessage(i18n, M.actions.commanderRecruited) : result.reason, !result.ok);
      updateUi(); return result.ok || result.reason;
    },
    onCommanderLevelUp: uid => {
      const result = simulation.levelUpCommander(uid);
      if (!result.ok) message(result.reason, true);
      updateUi(); return result.ok || result.reason;
    },
    onCatapultAmmo: (uid, kind) => {
      const result = simulation.setCatapultAmmo(uid, kind);
      if (result) updateUi();
      return result;
    },
    onMilitaryCoins: (uid, allowed) => {
      simulation.setMilitaryCoins(uid, allowed); updateUi();
    },
    onGarrisonComposition: (uid, counts) => {
      const result = simulation.setMilitaryComposition(uid, counts);
      if (result) updateUi();
      return result;
    },
    onPlanColony: (source, island, troops, commanderId) =>
      simulation.planColonyExpedition(source, island, troops, commanderId),
    onStartColony: (source, island, troops, commanderId) => {
      const blocked = refuseBlockedLaunch(context);
      if (blocked) return blocked;
      const result = simulation.startColonyExpedition(source, island, troops, false, commanderId);
      message(result.ok
        ? translateMessage(i18n, M.actions.colonyPreparing) : result.reason, !result.ok);
      updateUi(); return result.ok || result.reason;
    },
    onPlanAdventure: (source, island, troops, commanderId) =>
      simulation.planAdventureExpedition(source, island, troops, commanderId),
    onStartAdventure: (source, island, troops, commanderId) => {
      const blocked = refuseBlockedLaunch(context);
      if (blocked) return blocked;
      const result = simulation.startAdventureExpedition(source, island, troops, false, commanderId);
      message(result.ok
        ? translateMessage(i18n, M.actions.adventurePreparing) : result.reason, !result.ok);
      updateUi(); return result.ok || result.reason;
    },
    onReturnCommander: () => {
      const result = simulation.returnCommander();
      message(result.ok ? translateMessage(i18n, M.actions.commanderReturning) : result.reason, !result.ok);
      updateUi(); return result.ok || result.reason;
    },
    onCancelColony: id => {
      const result = simulation.cancelColonyExpedition(id);
      if (result) message(translateMessage(i18n, M.actions.colonyCancelled));
      updateUi(); return result;
    },
    onQueueTransport: (source, destination, goods) => {
      const result = simulation.queueSeaTransport(source, destination, { ...goods });
      message(translateMessage(i18n,
        result === null ? M.actions.cargoInvalid : M.actions.cargoQueued), result === null);
      updateUi();
      return result !== null;
    },
    onHomeSandbox: enabled => {
      const result = simulation.setHomeBuildingRules(withHomeSandbox(simulation.homeBuildingRules(), enabled));
      if (result === true)
        message(translateMessage(i18n, enabled ? M.actions.homeSandboxOn : M.actions.homeSandboxOff));
      else message(result, true);
      updateUi(); return result === true;
    },
    onWorkshopUpgrade: (uid, cancel) => {
      const result = cancel ? simulation.cancelWorkshopUpgrade(uid) : simulation.requestWorkshopUpgrade(uid);
      if (result) message(translateMessage(i18n,
        cancel ? M.actions.upgradeCancelled : M.actions.upgradeRequested));
      updateUi(); return result;
    },
    onDemolishBuilding: uid => {
      const result=simulation.demolishBuilding(uid);
      if(result.ok){onBuildingDemolished();message(translateMessage(i18n, M.actions.demolished));}
      else message(result.reason ?? translateMessage(i18n, M.actions.demolishRefused),true);
      updateUi();return result.ok;
    },
    onProductionPaused: (uid, paused) => { const result = simulation.setProductionPaused(uid, paused); if (result) updateUi(); return result; },
    onStorageCollect: (uid, ware, enabled) => {
      const result = simulation.setStorageCollect(uid, ware, enabled);
      updateUi();
      return result;
    },
    onProductionOrder: (uid, ware, amount) => {
      const result = simulation.setProductionOrder(uid, ware, amount);
      if (result) updateUi();
      return result;
    },
    onTavernRecruit: (uid, type, count) => {
      const result = simulation.orderTavernRecruits(uid, type, count);
      message(result.ok
        ? translateMessage(i18n, M.actions.recruitsOrdered) : result.reason, !result.ok);
      updateUi(); return result.ok || result.reason;
    },
    onProductionMode: (uid, ware) => { const result=simulation.setProductionMode(uid, ware); if(result)updateUi(); return result; }
  };
};

type SettlementPlayerActions = Pick<SettlementUiOptions, "onAdventureReward" | "onApplyTalents" | "onBuyGemOffer" |
  "onResetTalents" |
  "onCompleteQuest" | "onDisbandColony" | "onReadMessage" | "onRecallColonySoldiers" | "onReturnHome" |
  "onShowTutorial" | "onSkipTutorial" | "onTutorialOpened" | "onVisitColony">;

interface SettlementPlayerContext extends SettlementActionContext {
  buildingName: (typeId: number) => string;
  focusBuildingPanel: (uid: number) => void;
  getIslandTravel?: () => IslandTravel | undefined;
  onFocusBuilding?: (building: SettlementBuilding) => void;
  player?: PlayerSession;
  selectBuilding: (typeId: number) => void;
}

/** Progression (quests, tutorials, gem shop) and island travel requests from the HUD. */
export const createSettlementPlayerActions = (context: SettlementPlayerContext): SettlementPlayerActions => {
  const { buildingName, getIslandTravel, i18n, message, player, simulation, updateUi } = context;
  return {
    onAdventureReward: island => {
      const reward = adventureRewardFor(island, player?.level() ?? 1);
      const talents = player?.talentModifiers();
      return { experience: Math.round(reward.experience * (1 + (talents?.adventureExperience ?? 0))),
        goods: adventureRewardGoods(island, talents?.adventureLoot), perLevel: reward.perLevel };
    },
    onTutorialOpened: () => player?.tutorialOpened(),
    onSkipTutorial: id => {
      const result = player?.skipTutorial(id) ?? translateMessage(i18n, M.actions.tutorialsUnavailable);
      updateUi(); return result;
    },
    onShowTutorial: id => showTutorialTarget(id, simulation, {
      focus: building => { context.onFocusBuilding?.(building); context.focusBuildingPanel(building.uid); },
      select: typeId => { context.selectBuilding(typeId);
        message(translateMessage(i18n, M.actions.chooseSite, { building: buildingName(typeId) })); }
    }),
    // Publish at once so the inbox and the HUD unread count show the report as read.
    onReadMessage: id => { player?.readMessage(id); updateUi(); },
    onCompleteQuest: id => {
      const payingRelief = player?.reliefQuestStatus(id)?.stage === "awaiting-aid";
      const result = player?.completeQuest(id) ?? translateMessage(i18n, M.actions.questsUnavailable);
      settleCommand(result, outcome => {
        if (outcome === true && !payingRelief) message(translateMessage(i18n, M.actions.questCompleted));
        updateUi();
      });
      return result;
    },
    onApplyTalents: ranks => {
      const result = player?.applyTalents(ranks) ?? translateMessage(i18n, M.actions.talentsUnavailable);
      updateUi(); return result;
    },
    onResetTalents: () => {
      const result = player?.resetTalents() ?? translateMessage(i18n, M.actions.talentsUnavailable);
      settleCommand(result, updateUi);
      return result;
    },
    onBuyGemOffer: id => {
      const result = player?.buyGemOffer(id) ?? translateMessage(i18n, M.actions.gemShopUnavailable);
      settleCommand(result, outcome => {
        if (outcome === true) message(translateMessage(i18n, id === CHOOSE_NATION_OFFER_ID
          ? INVENTORY_MESSAGES.purchaseAdded : M.actions.purchaseDelivered));
        updateUi();
      });
      return result;
    },
    onVisitColony: id => {
      message(translateMessage(i18n, M.actions.sailingColony));
      void getIslandTravel?.()?.visit(id);
    },
    onRecallColonySoldiers: id => {
      getIslandTravel?.()?.recallSoldiers?.(id); updateUi();
    },
    onDisbandColony: id => {
      message(translateMessage(i18n, M.actions.disbandingColony));
      void getIslandTravel?.()?.disband(id);
    },
    onReturnHome: () => {
      message(translateMessage(i18n, M.actions.sailingHome));
      void getIslandTravel?.()?.returnHome();
    }
  };
};

interface ShipViewContext {
  onFocusShip?: (ship: { x: number; z: number }) => void;
  shipDemo: ReturnType<typeof createShipDemo>;
  simulation: SettlementSimulation;
}

/** Ship window view requests: deck preview and camera focus. */
export const createShipViewActions = (
  context: ShipViewContext
): Pick<SettlementUiOptions, "onFocusShip" | "shipDeckPreview"> => {
  const { shipDemo, simulation } = context;
  return {
    shipDeckPreview: {
      active: id => shipDemo.active(Number(id)),
      canPreview: id => shipDemo.canPreview(simulation.shipFrames().find(ship => ship.id === Number(id))),
      clear: shipDemo.clear,
      toggle: (id, kind) => shipDemo.toggle(simulation.shipFrames().find(ship => ship.id === Number(id)), kind)
    },
    onFocusShip: id => {
      const ship = simulation.ships().find(entry => String(entry.id) === id);
      if (ship) context.onFocusShip?.(ship);
    }
  };
};

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { adventureOutcomePopup, colonyOutcomePopup } from "../src/app/settlement-ui/colony-announcements";
import { getColonyRows, getDisbandConfirmation } from "../src/app/settlement-ui/colony-tracker/colony-list-helpers";
import { ColonyTrackerBody, TrackerHandle } from "../src/app/settlement-ui/colony-tracker/colony-tracker-view";
import {
  getExpeditionCard, getPendingExpeditions, getTrackerHeading, hasColonyTrackerContent, selectColonyTracker
} from "../src/app/settlement-ui/colony-tracker/helpers";
import type { ColonyTrackerView } from "../src/app/settlement-ui/colony-tracker/use-colony-tracker";
import { ExpeditionPlanner } from "../src/app/settlement-ui/expedition-planner/expedition-planner";
import {
  canStartExpedition, EMPTY_TROOPS, getAdventureBusyMessage,   getCommanderCards, getEstimateLabel, getExpeditionOngoingMessage,
getIslandCards, resolvePlannerIsland, selectPlanner, setPlannerTroop, startExpedition
} from "../src/app/settlement-ui/expedition-planner/helpers";
import { getLevelUpActions, levelUpPopup } from "../src/app/settlement-ui/level-up-popup";
import {
  BUILDING_PICKER_GROUPS, getBuildingCardGroups, getHighlightTabIndex, selectBuildingPicker
} from "../src/app/settlement-ui/main-panel/build-helpers";
import { getPopupView } from "../src/app/settlement-ui/popup/helpers";
import { PopupView } from "../src/app/settlement-ui/popup/popup-view";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import type { SettlementColonySummary, SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import type { AdventureIsland } from "../src/shared/settlement/adventure-rules";
import type { ColonyIsland } from "../src/shared/settlement/colony-expedition-rules";
import type { ColonyExpeditionSnapshot } from "../src/shared/settlement/settlement-colony-expeditions";
import type { CommanderSnapshot } from "../src/shared/settlement/settlement-commander";
import { COMMANDER_DEFINITIONS } from "../src/shared/settlement/settlement-commander";
import { renderWithI18n } from "./helpers/render-with-i18n";

const reef: ColonyIsland = { difficulty: "easy", id: 0, name: "Amber Reef", ore: "ironOre", seed: 1, voyageSeconds: 90 };
const cairn: ColonyIsland = { difficulty: "medium", id: 1, name: "Stormcairn", ore: "coal", seed: 2, voyageSeconds: 120 };
const skerry: AdventureIsland = {
  difficulty: "easy", id: 7, kind: "adventure", name: "Raven Skerry", seed: 3, size: 96, voyageSeconds: 90
};
const expedition = (patch: Partial<ColonyExpeditionSnapshot>): ColonyExpeditionSnapshot => ({
  arrived: 0, cargo: { planks: 4 }, crewReady: true, departed: 0, id: 1, island: reef, landed: {}, loads: 2,
  remainingSeconds: 75, sourceUid: 5, status: "preparing", suppliesReady: true,
  troops: { ...EMPTY_TROOPS, archer: 3 }, ...patch
});
const commanderAt = (patch: Partial<CommanderSnapshot> = {}): CommanderSnapshot => ({
  aura: { ...COMMANDER_DEFINITIONS.roman.aura },
  blockDetail: null,
  blockReason: null,
  canReturn: false,
  deckSlots: 2,
  definition: COMMANDER_DEFINITIONS.roman,
  developmentAllowed: false,
  healingSeconds: 0,
  healthReady: true,
  homeLodgeUid: 4,
  hp: 315,
  hpFraction: 1,
  id: "commander-1",
  level: 1,
  location: "lodge",
  maximumHp: 315,
  name: "Aurelius",
  nation: "roman",
  nextThreshold: 30,
  ready: true,
  recoveryComplete: true,
  recoverySeconds: 0,
  xp: 0,
  ...patch
});
const visible = () => createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true });
const storeWith = (snapshot: SettlementUiSnapshot) => {
  const store = createSettlementUiStore();
  store.update(snapshot);
  return store;
};

describe("expedition planner", () => {
  const islands = [{ ...reef, taken: true }, { ...cairn, taken: false }];

  it("falls back to the first free island and disables claimed ones", () => {
    expect(resolvePlannerIsland(islands, 0)).toBe(1);
    expect(resolvePlannerIsland(islands, 1)).toBe(1);
    expect(resolvePlannerIsland([], 1)).toBeNull();
    const cards = getIslandCards(islands, 1, "roman");
    expect(cards.map(card => [card.disabled, card.checked, card.detail.split(" · ")[0]]))
      .toEqual([[true, false, "Already claimed"], [false, true, "Coal"]]);
    expect(cards[1]!.levelClassName).toBe("colony-planner__level colony-planner__level--medium");
  });

  it("clamps a troop to stock and the difficulty cap without touching the others", () => {
    const troops = { ...EMPTY_TROOPS, shield: 15 };
    expect(setPlannerTroop(troops, "archer", 10, "easy", { archer: 40 })).toEqual({ ...troops, archer: 5 });
    expect(setPlannerTroop(troops, "archer", -3, "easy", { archer: 40 }).archer).toBe(0);
    expect(setPlannerTroop(troops, "archer", 4, "easy", { archer: 2 }).archer).toBe(2);
  });

  it("starts only with troops, a ship, an island and no expedition under way", () => {
    const plan = { loads: 1, seconds: 90, ships: 1, trips: 1 };
    const troops = { ...EMPTY_TROOPS, archer: 1 };
    expect(canStartExpedition(troops, plan, 1, null)).toBe(true);
    expect(canStartExpedition(EMPTY_TROOPS, plan, 1, null)).toBe(false);
    expect(canStartExpedition(troops, { ...plan, ships: 0 }, 1, null)).toBe(false);
    expect(canStartExpedition(troops, plan, null, null)).toBe(false);
    expect(canStartExpedition(troops, plan, 1, getExpeditionOngoingMessage())).toBe(false);
    expect(getEstimateLabel(plan)).toBe("1 ship(s) · 1 load(s) · 1 trip(s) · arrival ≈ 1:30");
    expect(getEstimateLabel(undefined)).toMatch(/No ship available/);
  });

  it("blocks adventures while one is abroad and passes the draft by value to the start command", () => {
    expect(selectPlanner("colony")({ expeditionOngoing: true }).blocked).toBe(getExpeditionOngoingMessage());
    expect(selectPlanner("adventure")({ adventures: [{ id: 2, island: skerry, status: "landed" }] }).blocked)
      .toBe(getAdventureBusyMessage());
    expect(selectPlanner("adventure")({ adventureIslands: [skerry] }).islands).toEqual([skerry]);
    const onStartColony = vi.fn(() => "No free ship" as const);
    const troops = { ...EMPTY_TROOPS, heavy: 2 };
    expect(startExpedition("colony", { onStartColony }, 5, 1, troops)).toBe("No free ship");
    expect(onStartColony).toHaveBeenCalledWith(5, 1, troops);
    expect(startExpedition("adventure", {}, 5, 1, troops)).toBe("The expedition cannot start.");
  });

  it("offers one optional commander card with No commander and passes the selection to the plan", () => {
    const ready = commanderAt();
    const away = commanderAt({ blockDetail: "Commander deployed abroad", blockReason: "away",
      canReturn: true, location: "away", ready: false });
    expect(getCommanderCards([away], null).map(card => [card.id, card.checked, card.disabled]))
      .toEqual([["", true, false], [away.id, false, true]]);
    expect(getCommanderCards([away], away.id).map(card => [card.id, card.checked, card.disabled]))
      .toEqual([["", false, false], [away.id, true, true]]);
    const cards = getCommanderCards([ready], ready.id);
    expect(cards[1]).toMatchObject({ checked: true, disabled: false, name: "Aurelius" });
    expect(cards[1]!.detail).toContain("Defensive");
    expect(cards[1]!.detail).toContain("HP 315 / 315");
    expect(cards[0]!.name).toBe("No commander");
  });

  it("renders the commander picker with accessible selected state and disabled reason", () => {
    const onPlanColony = vi.fn(() => ({ loads: 1, seconds: 90, ships: 1, trips: 1 }));
    const markup = renderWithI18n(createElement(ExpeditionPlanner, {
      context: {
        close: () => {}, harbour: createExternalStore(5), kind: "colony", options: { onPlanColony } as never,
        store: storeWith({ colonyIslands: islands, colonyTroops: { ...EMPTY_TROOPS, archer: 4 },
          commanders: [commanderAt()] }), visibility: visible()
      },
      islandLabel: "Colony island"
    }));
    expect(markup).toContain('aria-label="Commander (optional)" class="colony-planner__commanders"');
    expect(markup).toContain('data-commander-card="none"');
    expect(markup).toMatch(/<button(?=[^>]*data-commander-card="none")(?=[^>]*aria-checked="true")(?=[^>]*aria-label="No commander")/);
    expect(markup).toContain('data-commander-card="commander-1"');
    expect(markup).toContain("1 troop-cap unit · 2 deck slots");
    expect(markup).toContain("Aurelius");
  });

  it("renders island radios, NumberStepper troop rows, supplies and the start button", () => {
    const onPlanColony = vi.fn(() => ({ loads: 1, seconds: 90, ships: 0, trips: 0 }));
    const markup = renderWithI18n(createElement(ExpeditionPlanner, {
      context: {
        close: () => {}, harbour: createExternalStore(5), kind: "colony", options: { onPlanColony } as never,
        store: storeWith({ colonyIslands: islands, colonyTroops: { ...EMPTY_TROOPS, archer: 4 } }), visibility: visible()
      },
      islandLabel: "Colony island"
    }));
    expect(markup).toContain('<div aria-label="Colony island" class="colony-planner__islands" role="radiogroup"');
    expect(markup).toMatch(/<button(?=[^>]*data-colony-island="1")(?=[^>]*aria-checked="true")/);
    expect(markup).toContain('aria-label="Fewer archers" class="settlement-ui__button colony-planner__step"');
    expect(markup).toContain('<input aria-label="Archers to send" max="4" min="0" step="1" type="number" value="0"/>');
    expect(markup).toContain("<small>4 stored</small>");
    expect(markup).toContain("0 / 35 troops");
    expect(markup).toContain('aria-label="Supplies from this harbour"');
    expect(markup).toMatch(/aria-label="Start expedition" class="settlement-ui__button settlement-ui__button--primary" disabled=""/);
    expect(onPlanColony).toHaveBeenCalledWith(5, 1, EMPTY_TROOPS);
  });

  it("shows the committed climate and exact colony log/stone wares without changing old offers", () => {
    const offered = [
      { ...reef, taken: false, theme: "swamp" as const, resourceTier: 1 as const },
      { ...cairn, taken: false, theme: "winter" as const, resourceTier: 2 as const },
      { ...reef, taken: false, id: 2, theme: "desert" as const, resourceTier: 3 as const },
      { ...reef, taken: false, id: 3, theme: "tropical" as const, resourceTier: 4 as const }
    ];
    const cards = getIslandCards(offered, null, "japanese");
    expect(cards.map(card => card.art)).toEqual(["swamp", "winter", "desert", "tropical"]
      .map(theme => ({ kind: "icon", name: `island-${theme}` })));
    expect(cards.map(card => card.resources.map(resource => resource.ware))).toEqual([
      ["hardwoodLogs", "marble"], ["cedarLogs", "limestone"], ["walnutLogs", "basalt"], ["mahoganyLogs", "granite"]
    ]);
    const [legacy, adventure] = getIslandCards([{ ...reef, taken: false },
      { ...skerry, difficulty: "hard", theme: "forest" }], null, "roman");
    expect(legacy!.climate).toBe("forest"); expect(reef.theme).toBeUndefined();
    expect(legacy!.resources.map(resource => resource.ware)).toEqual(["logs", "stone"]);
    expect(adventure!.resources).toEqual([]); expect(adventure!.difficultyNumber).toBe(3);
  });
});

describe("colony tracker", () => {
  const colony = (patch: Partial<SettlementColonySummary>): SettlementColonySummary =>
    ({ id: 1, island: reef, status: "conquered", conqueredAt: 0, ...patch });

  it("shows while something is under way or listed, and lists landed expeditions only once", () => {
    expect(hasColonyTrackerContent({}, true)).toBe(false);
    expect(hasColonyTrackerContent({ activeColony: 3 }, true)).toBe(true);
    expect(hasColonyTrackerContent({ activeColony: 3 }, false)).toBe(false);
    const slice = selectColonyTracker({ colonies: [colony({})], colonyExpeditions: [expedition({}), expedition({ id: 2 })] });
    expect(getPendingExpeditions(slice).map(entry => entry.id)).toEqual([2]);
    expect(getTrackerHeading(true, 3)).toMatchObject({ expanded: false, heading: "Expeditions (3)", toggle: "Show expeditions" });
  });

  it("counts down and shows load progress only while sailing; details only when opened", () => {
    const sailing = getExpeditionCard(expedition({ arrived: 1, status: "sailing" }), "roman", false, true);
    expect(sailing).toMatchObject({ countdown: "1:15", progress: { max: 2, value: 1 }, details: undefined });
    const preparing = getExpeditionCard(expedition({}), "roman", true, true);
    expect(preparing.countdown).toBe("");
    expect(preparing.progress).toBeUndefined();
    expect(preparing.details).toMatchObject({ cancel: true, supplies: { heading: "Supplies held" } });
    expect(getExpeditionCard(expedition({ island: skerry }), "roman", true, false).details)
      .toMatchObject({ cancel: false, supplies: undefined });
  });

  it("offers a commander return action on the visited colony or adventure", () => {
    const options = { onDisbandColony: vi.fn(), onReturnCommander: vi.fn() };
    const deployed = commanderAt({ blockDetail: "Commander deployed abroad", blockReason: "away",
      canReturn: true, location: "field",
      transport: { destinationName: "Amber Reef", operationId: 4, phase: "deployed" } });
    const rows = getColonyRows(selectColonyTracker({ activeColony: 1, colonies: [colony({})],
      commanders: [deployed] }), 1000, options, vi.fn(), undefined);
    const action = rows.flatMap(row => row.actions).find(entry => entry.key === "commander")!;
    expect(action).toMatchObject({ disabled: false, label: "Return commander",
      data: { "data-commander-return": "1" } });
    action.onSelect();
    expect(options.onReturnCommander).toHaveBeenCalledTimes(1);
    const returning = commanderAt({ canReturn: false, location: "returning",
      transport: { destinationName: "Amber Reef", operationId: 4, phase: "returning" } });
    const pending = getColonyRows(selectColonyTracker({ activeColony: 1, colonies: [colony({})],
      commanders: [returning] }), 1000, options, vi.fn(), undefined)
      .flatMap(row => row.actions).find(entry => entry.key === "commander")!;
    expect(pending).toMatchObject({ disabled: true, label: "The commander is returning by ship." });
  });

  it("builds visit, recall and disband actions with their driver attributes", () => {
    const options = { onDisbandColony: vi.fn(), onRecallColonySoldiers: vi.fn(), onReturnHome: vi.fn(), onVisitColony: vi.fn() };
    const confirm = vi.fn();
    const slice = selectColonyTracker({ activeColony: 1, adventures: [{ id: 3, island: skerry, status: "landed" }],
      colonies: [colony({ incomingShips: [{ arrivalSeconds: 145, id: "9", name: "Supply ship", status: "away",
        troops: { archer: 4 }, wares: { planks: 10 } }], soldiers: 2, troopRecallPending: true,
      troopRecallStatus: "Ship arriving in 2:30" }), colony({ id: 2, island: cairn, status: "landed" })] });
    const rows = getColonyRows(slice, 1000, options, confirm);
    expect(rows.map(row => row.title)).toEqual(["Home island", "Colony · Amber Reef", "Colony · Stormcairn",
      "Adventure · Raven Skerry"]);
    const [home, here, other, adventure] = rows;
    expect(home!.actions[0]!.label).toBe("Return to the home island");
    expect(here!.detail).toBe("Easy · Conquered · free again in 13 d 23 h · Ship arriving in 2:30 · You are here");
    expect(here!.actions.map(action => [action.label, action.disabled, action.data]))
      .toEqual([["Ship arriving in 2:30", true, { "data-colony-recall": "1" }], ["Disband Amber Reef", undefined, undefined]]);
    expect(here!.incoming[0]).toMatchObject({ eta: "Arrives in ≈ 2:25" });
    expect(here!.incoming[0]!.cargo.map(item => item.label)).toEqual(["10 Softwood planks", "Archer: 4"]);
    expect(other!.actions[0]).toMatchObject({ data: { "data-colony-visit": "2" }, label: "Visit Stormcairn" });
    expect(adventure!.actions[0]!.data).toEqual({ "data-adventure-visit": "3" });
    adventure!.actions[1]!.onSelect();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Abandon Raven Skerry?" }));
    getDisbandConfirmation(colony({ id: 2 }), false, options.onDisbandColony).actions[0]!.onSelect!();
    expect(options.onDisbandColony).toHaveBeenCalledWith(2);
  });

  it("renders cards, rows and the handle with the existing classes", () => {
    const view = {
      cards: [getExpeditionCard(expedition({ status: "sailing" }), "roman", false, false)],
      header: getTrackerHeading(false, 1),
      rows: getColonyRows(selectColonyTracker({ colonies: [colony({ id: 2, island: cairn, status: "landed" })] }), 0,
        { onVisitColony: () => {} }, () => {}),
      onCancel: () => {}, onToggleCard: () => {}, onToggleCollapsed: () => {}
    } as ColonyTrackerView;
    const body = renderWithI18n(createElement(ColonyTrackerBody, { view }));
    expect(body).toContain('<article class="colony-tracker__card" data-colony-expedition="1">');
    expect(body).toContain('<time class="colony-tracker__countdown">1:15</time>');
    expect(body).toContain('<progress class="colony-tracker__progress" max="2" value="0"></progress>');
    expect(body).toContain('<section aria-label="Colonies" class="colony-tracker__colonies"><article class="colony-tracker__colony">');
    expect(body).toContain('aria-label="Visit Stormcairn" class="settlement-ui__button colony-tracker__visit" title="Visit Stormcairn" type="button" data-colony-visit="2"');
    const handle = renderWithI18n(createElement(TrackerHandle, { header: view.header, onToggle: () => {} }));
    expect(handle).toContain('<button aria-expanded="true" aria-label="Minimise expeditions" class="settlement-ui__button colony-tracker__toggle"');
  });
});

describe("settlement popup", () => {
  it("prepares colony, adventure and level-up content as data", () => {
    const won = colonyOutcomePopup("conquered", reef, "viking", { experience: 120, onReturnHome: () => {} });
    expect(won.actions.map(action => action.label)).toEqual(["Stay and build", "Sail home"]);
    expect(won.art).toMatchObject({ className: "settlement-popup__emblem", kind: "image" });
    expect(colonyOutcomePopup("defeated", reef, "roman").art).toEqual({ kind: "ware", ware: "ironOre" });
    const adventure = adventureOutcomePopup("won", skerry, "roman", { experience: 50, goods: { coins: 20 } });
    expect(adventure.rewards!.entries).toEqual([{ amount: 50, kind: "xp" }, { amount: 20, kind: "coins" }]);
    const level = levelUpPopup([{ coins: 5, gems: 0, level: 2 }, { coins: 7, gems: 3, level: 3 }] as never);
    expect(level.title).toBe("Level 3!");
    expect(level.message).toBe("Your settlers celebrate! The coins wait in your headquarters. New tutorial chapter: " +
      "Water and fishing. New buildings are ready in the build menu:");
    expect(level.rewards!.entries).toEqual([{ amount: 12, kind: "coins" }, { amount: 3, kind: "gems" }]);
    expect(level.buildings).toEqual([
      { label: "Quarry", type: 19 }, { label: "Sawmill", type: 33 }, { label: "Fishery", type: 18 }, { label: "Well", type: 35 }
    ]);
    expect(levelUpPopup([{ coins: 5, gems: 0, level: 7 }] as never, "viking").buildings!.map(entry => entry.type))
      .toEqual([28]);
  });

  it("leads with Build when the level-up unlocked buildings and opens the picker on them", () => {
    expect(getLevelUpActions([], vi.fn())).toEqual([{ label: "Close", primary: true }]);
    expect(getLevelUpActions([19])).toEqual([{ label: "Close", primary: true }]);
    const onBuild = vi.fn();
    const [build, close] = getLevelUpActions([19, 33], onBuild);
    expect(build).toMatchObject({ icon: "build", label: "Build", primary: true });
    expect(close).toEqual({ label: "Close" });
    build!.onSelect!();
    expect(onBuild).toHaveBeenCalledWith([19, 33]);
    expect(levelUpPopup([{ coins: 5, gems: 0, level: 3 }] as never, "roman", onBuild).actions[0]!.label)
      .toBe("Build");
  });

  it("selects the first highlighted building's category and marks the highlighted cards", () => {
    const fisheryTab = BUILDING_PICKER_GROUPS.findIndex(group => group.buildings.some(entry => entry.id === 18));
    expect(getHighlightTabIndex("18,19")).toBe(fisheryTab + 1);
    expect(getHighlightTabIndex("")).toBe(1);
    const picker = selectBuildingPicker({ buildHighlight: "18", buildHighlightRevision: 2 });
    expect(picker).toMatchObject({ highlight: "18", highlightRevision: 2 });
    const cards = getBuildingCardGroups(picker).flatMap(group => group.cards);
    expect(cards.find(card => card.id === 18)!.className).toBe("settlement-ui__card settlement-ui__card--new");
    expect(cards.find(card => card.id === 19)!.className).toBe("settlement-ui__card");
  });

  it("gives every outcome action an icon and keeps the sail-home ship and arrow visible", () => {
    const outcomes = [
      adventureOutcomePopup("won", skerry, "roman", { experience: 50, goods: {} }, () => {}),
      adventureOutcomePopup("defeated", skerry, "roman", undefined, () => {}),
      colonyOutcomePopup("conquered", reef, "roman", { onReturnHome: () => {} }),
      colonyOutcomePopup("defeated", reef, "roman", { onDisband: () => {} })
    ];
    expect(outcomes.flatMap(outcome => outcome.actions).filter(action => !action.icon)).toEqual([]);
    for (const outcome of outcomes.slice(0, 2)) {
      const markup = renderWithI18n(createElement(PopupView, {
        revision: 1, view: getPopupView(outcome), onAction: () => {}
      }));
      expect(markup).toMatch(/aria-label="Sail home"[^>]*><span aria-hidden="true" class="settlement-sail-back-icon">(<img [^>]*class="settlement-art-icon"[^>]*\/>){2}<\/span><\/button>/);
    }
    const iconStyles = readFileSync(new URL("../src/app/settlement-ui/icon-styles.css", import.meta.url), "utf8");
    expect(iconStyles).not.toMatch(/settlement-popup__icon-action[^{]*span[^{]*\{[^}]*display: none/);
  });

  it("renders an alert dialog card with rewards and the actions", () => {
    const view = getPopupView(adventureOutcomePopup("won", skerry, "roman", { experience: 1500, goods: { coins: 20 } }));
    expect(view.actions[0]).toMatchObject({ caption: undefined,
      className: "settlement-popup__icon-action settlement-ui__button--primary", label: "Sail home" });
    const markup = renderWithI18n(createElement(PopupView, { revision: 1, view, onAction: () => {} }));
    expect(markup).toMatch(/<section aria-labelledby="settlement-popup-title" aria-modal="true" class="settlement-ui__panel settlement-popup__dialog settlement-popup__dialog--rewards" data-tone="victory" role="alertdialog"><img alt="" class="settlement-popup__emblem"/);
    expect(markup).toContain('<h2 id="settlement-popup-title">Adventure won!</h2>');
    expect(markup).toContain('<div aria-label="Rewards" class="reward-icons" role="group"><span class="reward-icons__experience">');
    expect(markup).toContain('<span>+1,500 XP</span>');
    expect(markup).toContain('<li aria-label="20 Gold coins" class="reward-icons__item" title="Gold coins">');
    expect(markup).toContain('<div class="settlement-popup__actions"><button aria-label="Sail home"');
    const question = renderWithI18n(createElement(PopupView, {
      revision: 2, view: getPopupView(levelUpPopup([{ coins: 1, gems: 0, level: 2 }] as never)), onAction: () => {}
    }));
    expect(question).toContain('<button class="settlement-ui__button settlement-popup__text-button settlement-ui__button--primary" type="button">Close</button>');
    expect(question).toContain('<ul aria-label="New buildings" class="settlement-popup__buildings">');
  });
});

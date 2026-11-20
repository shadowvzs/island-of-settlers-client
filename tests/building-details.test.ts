import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CountStepper } from "../src/app/components/count-stepper";
import { InfoTooltip } from "../src/app/components/info-tooltip";
import { getTooltipPosition } from "../src/app/components/info-tooltip-helpers";
import { createExternalStore, isDeepEqual } from "../src/app/components/ui-store";
import { BuildingDetails } from "../src/app/settlement-ui/building-details/building-details";
import { StoragePages } from "../src/app/settlement-ui/building-details/completed-building";
import { getConstructionDetails } from "../src/app/settlement-ui/building-details/construction-helpers";
import { getChangedGarrisonPlan, getGarrisonView } from "../src/app/settlement-ui/building-details/garrison-helpers";
import { getHarbourOrders, getScoutingView } from "../src/app/settlement-ui/building-details/harbour-helpers";
import {
  getBuildingDetailsTitle, getFooterActions, selectBuildingDetails
} from "../src/app/settlement-ui/building-details/helpers";
import { getProductionWares } from "../src/app/settlement-ui/building-details/production-helpers";
import {
  getArmoryOrders, getProductionOutputChoices, getProductionToggle, getShipyardModes, getShipyardRecipeView
} from "../src/app/settlement-ui/building-details/production-mode-helpers";
import { getSoldierGroups } from "../src/app/settlement-ui/building-details/soldier-helpers";
import {
  applyStorageCollect, getStorageCells, getStoragePageToggle
} from "../src/app/settlement-ui/building-details/storage-helpers";
import {
  getTavernIngredients, getTavernOrder, getTavernQueueText, getTavernSchedule, stepTavernCount
} from "../src/app/settlement-ui/building-details/tavern-helpers";
import { getUpgradeBenefitLines, getUpgradeView } from "../src/app/settlement-ui/building-details/upgrade-helpers";
import { WorkforceSection } from "../src/app/settlement-ui/building-details/workforce-section";
import { getWareIconSource } from "../src/app/settlement-ui/inventory";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import type {
  SettlementBuildingSummary, SettlementGarrisonSummary, SettlementUiOptions, SettlementUiSnapshot
} from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { MAX_TAVERN_ORDER } from "../src/shared/balance/military";
import { workshopUpgradeLevels } from "../src/shared/settlement/building-level-benefits";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { renderWithI18n } from "./helpers/render-with-i18n";

const counts = (shield = 0, heavy = 0, archer = 0) => ({ archer, heavy, shield });
const garrisonSummary = (patch: Partial<SettlementGarrisonSummary> = {}): SettlementGarrisonSummary => ({
  assigned: counts(), capacity: 3, coinCapacity: 6, coinIncoming: 0, coinStock: 0, coinsAllowed: true,
  drinkCapacity: 3, drinkIncoming: 0, drinkStock: 0, drinkWare: "wine",
  manual: null, posts: 0, stationed: counts(),
  stationedByRank: { archer: [0, 0, 0], heavy: [0, 0, 0], shield: [0, 0, 0] },
  stored: counts(), ...patch
});
const building = (fields: Partial<SettlementBuildingSummary> & { type: number }): SettlementBuildingSummary =>
  ({ completed: true, id: "7", ...fields });
const visible = () => createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true });
const commands: SettlementUiOptions = {
  onDemolishBuilding: () => false, onGarrisonComposition: () => true,
  onMilitaryCoins: () => true, onMilitaryTrainingFocus: () => true,
  onMinimap: () => {}, onProductionMode: () => true, onProductionOrder: () => true, onProductionPaused: () => true,
  onRoadMode: () => {}, onRotate: () => {}, onSawmillMode: () => true, onSelectBuilding: () => {},
  onSettings: () => {},
  onShipyardMode: () => true, onStorageCollect: () => true,
  onTavernRecruit: () => true, onWorkshopUpgrade: () => true
};
/** Markup of the details window focused on `subject`. */
const render = (subject: SettlementBuildingSummary, snapshot: SettlementUiSnapshot = {}, options = commands) => {
  const store = createSettlementUiStore();
  store.update({ buildings: [subject], focusedBuilding: subject.id, playerNation: "roman", ...snapshot });
  return renderWithI18n(createElement(BuildingDetails, { options, store, visibility: visible() }));
};

/** Markup of the harbour page inside the same details body. */
const renderHarbourPage = (subject: SettlementBuildingSummary, snapshot: SettlementUiSnapshot = {}, options = commands) => {
  const data = selectBuildingDetails({ buildings: [subject], focusedBuilding: subject.id, playerNation: "roman", ...snapshot });
  const drafts = {
    drafts: { page: "harbour", tavern: { count: 1, type: "shield" }, tool: null },
    setPage: () => {}, setTavern: () => {}, setTool: () => {}
  } as never;
  return renderWithI18n(createElement(StoragePages, { building: subject, data, drafts, options, sections: {} as never }));
};

describe("building details helpers", () => {
  it("selects the focused building and titles the window with its name", () => {
    const farm = building({ type: 37 });
    const data = selectBuildingDetails({ buildings: [building({ id: "1", type: 0 }), farm], focusedBuilding: "7" });
    expect(data.building).toBe(farm);
    expect(data.level).toBe(1);
    expect(getBuildingDetailsTitle(undefined)).toBe("Building details");
    expect(getBuildingDetailsTitle(building({ displayName: "Bandit camp", type: 3 }))).toBe("Bandit camp");
  });

  it("treats a re-published unchanged building as equal and reads totals only where shown", () => {
    const snapshot = (logs: number): SettlementUiSnapshot => ({ buildings: [building({ inventory: { logs }, type: 0 })],
      focusedBuilding: "7", resources: { logs } });
    const first = selectBuildingDetails(snapshot(4));
    expect(first.resources, "no Tavern: realm stock not selected").toBeUndefined();
    expect(isDeepEqual(first, selectBuildingDetails(snapshot(4)))).toBe(true);
    expect(isDeepEqual(first, selectBuildingDetails(snapshot(5)))).toBe(false);
    expect(isDeepEqual([1], { 0: 1 })).toBe(false);
  });

  it("builds the action row only when it has an action", () => {
    expect(getFooterActions(building({ type: 0 }), {} as SettlementUiOptions, "resources")).toMatchObject({
      demolish: false, storagePage: true, storageTools: false
    });
    expect(getFooterActions(building({ type: 0 }), commands, "settlers")?.storageTools).toBe(false);
    expect(getFooterActions(building({ type: 37 }), {} as SettlementUiOptions, "resources")).toBeNull();
    expect(getFooterActions(building({ completed: false, type: 37 }), commands, "resources"))
      .toEqual({ demolish: true, pause: false, storagePage: false, storageTools: false, upgrade: false });
  });

  it("selects collection wares and keeps carts local instead of editing old receiving/export policies", () => {
    const depot = building({ type: 0, inventory: { logs: 4, stone: 2 }, storedHandcarts: 1, totalHandcarts: 3,
      accepts: { logs: false }, exports: { stone: true },
      storageCollect: { visible: true, available: true, wares: ["stone"], unavailableWares: [] } });
    const rows = getStorageCells(depot, commands, "roman", 1, undefined, "collect");
    expect(rows.find(cell => cell.ware === "logs")).toMatchObject({ count: "4", collecting: false, disabled: false });
    expect(rows.find(cell => cell.ware === "stone")).toMatchObject({ collecting: true });
    expect(rows.find(cell => cell.ware === "handcart"))
      .toMatchObject({ disabled: true, label: expect.stringContaining("2 in use") });
    const collect = vi.fn(() => true);
    const options = { ...commands, onStorageCollect: collect };
    applyStorageCollect(depot, options, "collect", "logs");
    applyStorageCollect(depot, options, "collect", "stone");
    expect(collect).toHaveBeenNthCalledWith(1, 7, "logs", true);
    expect(collect).toHaveBeenNthCalledWith(2, 7, "stone", false);
  });

  it("lists construction materials and ground preparation", () => {
    const site = building({ completed: false, construction: { consumed: { planks: 1 }, foundationProgress: .5,
      incoming: { planks: 2 }, progress: .25, required: { planks: 4 } }, input: { planks: 1 }, type: 37 });
    expect(getConstructionDetails(site)).toMatchObject({
      foundation: "Ground preparation: 50%", progressText: "Construction: 25%", showMaterials: true,
      materials: [{ delivered: "2", incoming: "2", required: "4", ware: "planks" }]
    });
  });

  it("steps the garrison plan, keeping the last soldier of an occupied building", () => {
    const garrison = garrisonSummary({ assigned: counts(1), minimum: 1, posts: 2, stationed: counts(1),
      stationedByRank: { archer: [0, 0, 0], heavy: [0, 0, 0], shield: [1, 0, 0] }, stored: counts(2) });
    const view = getGarrisonView(garrison, "roman");
    expect(view.heading).toBe("Garrison 1/3 · 2 tower posts for archers");
    expect(view.rows[0]).toMatchObject({ count: "1", decreaseDisabled: true, increaseDisabled: false,
      decreaseTitle: "At least one soldier must remain in an occupied building" });
    expect(view.insideRows).toEqual([{
      count: "1", icon: expect.any(String), key: "shield-0", label: "1 Swordsman, Recruit",
      rank: 0, rankBadge: "I", rankName: "Recruit", title: "1 Swordsman, Recruit",
      type: "shield", typeName: "Swordsman", wounded: 0, woundedText: ""
    }]);
    expect(view.trainingNote).toBe("One coin and one wine promote one stationed soldier by one rank.");
    expect(getChangedGarrisonPlan(garrison, "shield", -1)).toBeNull();
    expect(getChangedGarrisonPlan(garrison, "shield", 1)).toEqual(counts(2));
  });

  it("separates arriving and requested troops from the soldiers physically inside", () => {
    const garrison = garrisonSummary({
      assigned: counts(3, 1), manual: counts(4, 1),
      stationed: counts(1), stationedByRank: { archer: [0, 0, 0], heavy: [0, 1, 0], shield: [1, 0, 0] }
    });
    const view = getGarrisonView(garrison, "roman");
    expect(view.insideRows.map(row => row.key)).toEqual(["shield-0", "heavy-1"]);
    expect(view.rows[0]).toMatchObject({ arriving: 2, movement: "2 arriving · 1 requested", requested: 1 });
    expect(view.rows[1]).toMatchObject({ arriving: 1, movement: "1 arriving", requested: 0 });
  });

  it("keeps a wounded garrison group visibly wounded and its soldier details accessible", () => {
    const garrison = garrisonSummary({
      stationed: counts(2), stationedByRank: { archer: [0, 0, 0], heavy: [0, 0, 0], shield: [2, 0, 0] }
    });
    const view = getGarrisonView(garrison, "roman", [
      { actor: 4, health: 10, maximumHealth: 10, phase: "garrison", rank: 0, type: "shield" },
      { actor: 5, health: 6, maximumHealth: 10, phase: "garrison", rank: 0, type: "shield" }
    ]);
    expect(view.insideRows[0]).toMatchObject({ count: "2", wounded: 1, woundedText: "1 wounded · 16/20 HP" });
    expect(view.insideRows[0]?.title).toContain("2 Swordsmen, Recruit");
    expect(view.insideRows[0]?.title).toContain("Swordsman #5 · Recruit · 10/10 HP · Stationed");
    expect(view.insideRows[0]?.title).toContain("Swordsman #6 · Recruit · 6/10 HP · Stationed");
  });

  it("keeps the Tavern order within its limits and reports missing ingredients", () => {
    expect(stepTavernCount(1, -1)).toBe(1);
    expect(stepTavernCount(MAX_TAVERN_ORDER, 1)).toBe(MAX_TAVERN_ORDER);
    expect(getTavernOrder({ count: 1, type: "archer" }, "roman")).toMatchObject({ decreaseDisabled: true, submit: "Recruit 1" });
    const ingredients = getTavernIngredients("shield", { current: null, freeSettlers: 0, queue: [] }, {});
    expect(ingredients[0]).toMatchObject({ enough: "false", key: "settler", ware: null });
    expect(getTavernQueueText({ current: { stage: "train", type: "archer" }, freeSettlers: 1,
      queue: [{ count: 2, type: "shield" }] }, "roman")).toBe("Now: Archer: being equipped inside. Ordered: 2 × Swordsman.");
  });

  it("turns the Tavern orders into an active row and a scheduled box", () => {
    const summary = {
      current: { stage: "collect" as const, type: "archer" as const }, freeSettlers: 3,
      queue: [{ count: 2, type: "archer" as const }, { count: 3, type: "shield" as const }]
    };
    const schedule = getTavernSchedule(summary, "roman");
    expect(schedule.current).toMatchObject({ count: 2, type: "archer" });
    expect(schedule.waiting).toMatchObject([{ count: 3, type: "shield" }]);
    expect(schedule.total).toBe(5);
    const waiting = getTavernSchedule({ ...summary, current: null }, "roman");
    expect(waiting.current).toMatchObject({ count: 2, type: "archer" });
    expect(waiting.current?.stage).toBe("waiting for the innkeeper");
  });

  it("steps armory orders and toggles unlimited production", () => {
    const rows = getArmoryOrders(building({ productionOrders: { shield: 0, sword: 3 }, type: 24 }));
    expect(rows[0]).toMatchObject({ count: "0", decrease: 0, decreaseDisabled: true, unlimitedNext: null });
    expect(rows[1]).toMatchObject({ count: "3", decrease: 2, increase: 4 });
    expect(rows[2]).toMatchObject({ count: "∞", unlimited: true, unlimitedNext: 0 });
  });

  it("offers output choices and product toggles", () => {
    expect(getProductionOutputChoices(25)?.[0]).toEqual({ label: "Random tools", value: "randomTools" });
    expect(getProductionOutputChoices(25)?.find(choice => choice.value === "fishingRod")?.label).toBe("Fishing Rod");
    expect(getProductionOutputChoices(24)).toBeNull();
    expect(getProductionToggle(getShipyardModes(), "ships"))
      .toEqual({ icon: "ship", label: "Ships: click to produce boats", next: "boats", pressed: true });
  });

  it("explains shipyard modes and reports actual required, consumed and stored materials", () => {
    const boats = getShipyardRecipeView(building({ input: { planks: 2 }, shipyardMode: "boats", type: 36 }));
    expect(boats.requirement).toContain("No cloth required");
    expect(boats.progress).toBe("Boat planks used: 0/1.");
    expect(boats.riggingIncomplete).toBeNull();
    const ships = getShipyardRecipeView(building({
      incoming: { cloth: 1 },
      input: { cloth: 1, planks: 2 },
      shipyardMode: "ships",
      shipyardSite: { cloth: 1, planks: 8 },
      type: 36
    }));
    expect(ships.requirement).toContain("10 softwood planks and 4 cloth");
    expect(ships.progress).toContain("Hull: 8/10 planks");
    expect(ships.progress).toContain("Rigging: 1/4 cloth");
    expect(ships.stored).toContain("Stored here: 2 planks, 1 cloth");
    expect(ships.stored).toContain("Incoming: 0 planks, 1 cloth");
    expect(ships.riggingIncomplete).toContain("Rigging incomplete");
    const markup = render(building({ input: { planks: 2 }, shipyardMode: "ships", type: 36 }));
    expect(markup).toContain('data-count="2" data-ware="planks"');
    expect(markup).toContain('data-count="0" data-ware="cloth"');
    expect(markup).toContain("Requires 10 softwood planks and 4 cloth.");
    expect(markup).toContain("Sea ships carry goods, passengers, troops and commanders");
    expect(markup).not.toContain("shuttle");
    expect(markup).toContain('aria-describedby="shipyard-mode-help-7"');
  });

  it("shows one Random tools composition in the metalworks output while it is selected", () => {
    const random = getProductionWares(building({ output: { axe: 2, saw: 1 }, type: 25 }));
    expect(random?.output?.cells).toEqual([
      { count: "3", label: "Random tools: 3", name: "Random tools", ware: "randomTools" }
    ]);
    expect(random?.output?.randomTools).toEqual(["axe", "saw", "pickaxe"]);
    const axe = getProductionWares(building({ selectedOutput: "axe", type: 25 }));
    expect(axe?.output?.cells.map(cell => cell.ware)).toEqual(["axe"]);
    expect(axe?.output?.randomTools).toBeUndefined();
  });

  it("describes upgrade levels from the shared upgrade table", () => {
    const levels = workshopUpgradeLevels(33);
    const lines = getUpgradeBenefitLines(33, 2);
    expect(lines).toHaveLength(levels.length + 1);
    expect(lines[1]!.text).toMatch(/\(reached\)$/);
    expect(lines[2]).toMatchObject({ marked: true, text: expect.stringMatching(/^Level 3: .*\(next\)$/) });
    expect(getUpgradeBenefitLines(37, 1).length).toBeGreaterThan(0);
    expect(getUpgradeBenefitLines(3000, 1)).toEqual([]);
    const view = getUpgradeView(building({ type: 37, upgradeSupply: {} }));
    expect(view.current).toBe("Now (level 1): base building, no upgrade bonus.");
    expect(view.next).toBe("Level 2: +10% work speed.");
    expect(view.request).toMatchObject({ button: "Upgrade", disabled: true });
    expect(view.request!.costItems.map(item => item.text)).toEqual(["Hardwood planks: 4", "Marble: 2"]);
  });

  it("shows the current and next level effect and cost up to level 5", () => {
    const level3 = getUpgradeView(building({ type: 4, upgradeSupply: {}, workshopUpgrade: { level: 2 } }));
    expect(level3.heading).toBe("Upgrade to level 4");
    expect(level3.current).toBe("Now (level 3): +30% door strength; +20% territory: radius 39 → 47.");
    expect(level3.next).toBe("Level 4: +45% door strength; +30% territory: radius 39 → 51.");
    expect(level3.request!.costItems.map(item => item.ware)).toEqual(["walnutPlanks", "basalt"]);
    expect(level3.request!.status).toMatch(/^The garrison stays inside\. .*6 walnut planks and 4 basalt/);
    const top = getUpgradeView(building({ type: 29, workshopUpgrade: { level: 4 } }));
    expect(top.heading).toBe("Building level 5 (maximum)");
    expect(top.current).toBe("Now (level 5): +100% storage: 500 → 1000 per ware.");
    expect(top.next).toBeNull();
    expect(top.request).toBeNull();
  });

  it("names the cancellable voyages", () => {
    expect(getHarbourOrders(7, [{ destinationUid: 1, expedition: false, exploration: true, id: 3, passengers: 3,
      sourceUid: 7 }])).toEqual([{ id: 3, label: "Cancel exploration 3" }]);
  });

  it("keeps the tooltip inside the viewport, flipping above near the bottom", () => {
    const anchor = { bottom: 820, left: 370, top: 790, width: 30 };
    expect(getTooltipPosition(anchor, { height: 100, width: 300 }, { height: 844, width: 390 }))
      .toEqual({ left: 82, placement: "above", top: 684 });
    expect(getTooltipPosition({ bottom: 40, left: 0, top: 10, width: 30 }, { height: 50, width: 200 },
      { height: 800, width: 1280 })).toEqual({ left: 8, placement: "below", top: 46 });
  });
});

describe("building details markup", () => {
  it("renders the storage Resources page with its pool, tools and page toggle", () => {
    const markup = render(building({ inventory: { logs: 4 }, type: 0,
      storageCollect: { visible: true, available: true, wares: [], unavailableWares: [] },
      storageCapacity: { capacity: 500, reserved: {}, stored: { logs: 4 } } as never }));
    expect(markup)
      .toContain('<p aria-label="Building level" class="settlement-ui__building-level" data-building-level="1">');
    expect(markup)
      .toContain('class="settlement-ui__inventory settlement-ui__storage-wares" data-building-inventory="7"');
    const logs = markup.match(/<button[^>]*data-ware="logs"[^>]*>/)![0];
    expect(logs).toContain('data-count="4"');
    expect(logs).toContain('data-collecting="false"');
    expect(markup).toContain('<small class="settlement-ui__storage-pool"');
    expect(markup).toContain('aria-label="Collect" aria-pressed="false"');
    expect(markup).toContain('data-storage-tool="collect"');
    expect(markup).not.toContain('data-storage-tool="receive"');
    expect(markup).not.toContain('data-storage-tool="send"');
    expect(markup).toContain('aria-label="Show settlers" aria-pressed="false"');
    expect(markup).toContain('data-storage-page-next="7"');
    expect(getStoragePageToggle("resources")).toMatchObject({
      label: "Show settlers", next: "settlers", pressed: false
    });
    expect(getStoragePageToggle("settlers")).toMatchObject({
      label: "Show soldiers", next: "soldiers", pressed: true
    });
    expect(getStoragePageToggle("soldiers")).toMatchObject({
      label: "Show resources", next: "resources", pressed: true
    });
    expect(getStoragePageToggle("settlers", undefined, true)).toMatchObject({
      label: "Show harbour", next: "harbour", pressed: true
    });
    expect(getStoragePageToggle("harbour", undefined, true)).toMatchObject({
      label: "Show soldiers", next: "soldiers", pressed: true
    });
  });

  it("shows compact held/incoming badges on shared ware icons with an explanatory tooltip", () => {
    const markup = render(building({
      storage: { available: { planks: 2 }, capacity: 10, held: { planks: 1 },
        incoming: { planks: 3 }, poolId: 0, stored: { planks: 1 } },
      type: 0
    }));
    const planks = markup.match(/<button[^>]*data-ware="planks"[^>]*>.*?<\/button>/)![0];
    expect(planks).toContain('data-count="2"');
    expect(planks).toContain('class="settlement-ui__storage-held">1</span>');
    expect(planks).toContain('class="settlement-ui__storage-incoming">+3</span>');
    expect(planks).toContain("Held 1 (reserved for outgoing loads)");
    expect(planks).toContain("Incoming 3 (on the way)");
  });

  it("keeps the storage soldier reserve off the Resources page", () => {
    const markup = render(building({
      soldiers: [{ actor: 9, health: 10, maximumHealth: 10,
        phase: "militaryReserve", rank: 0, type: "shield" }],
      type: 29
    }));
    expect(markup).not.toContain("settlement-ui__soldier-inventory");
    expect(markup).not.toContain("settlement-ui__soldier-roster");
  });

  const renderSoldierPage = (soldiers: SettlementBuildingSummary["soldiers"]) => {
    const drafts = {
      drafts: { page: "soldiers", tavern: { count: 1, type: "shield" }, tool: null },
      setPage: () => {}, setTavern: () => {}, setTool: () => {}
    } as never;
    return renderWithI18n(createElement(StoragePages, {
      building: building({ soldiers, type: 29 }),
      data: { level: 1, nation: "roman", resources: {} },
      drafts, options: commands, sections: {} as never
    }));
  };

  it("uses the same soldier storage page at the headquarters, storehouses and harbours", () => {
    const soldiers = [{ actor: 9, health: 10, maximumHealth: 10,
      phase: "militaryReserve", rank: 0, type: "shield" as const }];
    for (const type of [0, 29, 39]) {
      const drafts = {
        drafts: { page: "soldiers", tavern: { count: 1, type: "shield" }, tool: null },
        setPage: () => {}, setTavern: () => {}, setTool: () => {}
      } as never;
      const markup = renderWithI18n(createElement(StoragePages, {
        building: building({ soldiers, type }),
        data: { level: 1, nation: "roman", resources: {} },
        drafts, options: commands, sections: {} as never
      }));
      expect(markup).toContain('class="settlement-ui__inventory settlement-ui__soldier-inventory"');
      expect(markup).toContain('data-count="1" data-rank="0" data-troop="shield" data-wounded="0"');
      expect(markup).not.toContain("Equipment for soldier");
    }
  });

  it("renders the third storage page as a fixed-type icon grid with a local total", () => {
    const markup = renderSoldierPage([
      { actor: 9, health: 10, maximumHealth: 10, phase: "militaryReserve", rank: 0, type: "shield" },
      { actor: 10, health: 6, maximumHealth: 10, phase: "militaryReserve", rank: 1, type: "shield" }
    ]);
    expect(markup).toContain('aria-label="Soldiers in this building" '
      + 'class="settlement-ui__inventory settlement-ui__soldier-inventory"');
    expect(markup).toContain("2 soldiers stored here");
    expect(markup).toContain('class="settlement-ui__inventory-grid"');
    expect(markup).toContain('data-count="1" data-rank="0" data-troop="shield" data-wounded="0"');
    expect(markup).toContain('data-count="1" data-rank="1" data-troop="shield" data-wounded="1"');
    expect(markup).toContain("1 wounded · 6/10 HP");
    expect(markup).toContain('data-rank-level="1"');
    expect(markup).toContain('data-rank-level="2"');
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("Change equipment");
    expect(markup).not.toContain("Equipment");
  });

  it("renders an empty stored-soldier page like the other storage pages", () => {
    const markup = renderSoldierPage([]);
    expect(markup).toContain("0 soldiers stored here");
    expect(markup).toContain("No soldiers are stored here.");
    expect(markup).not.toContain('class="settlement-ui__inventory-grid"');
    expect(markup).not.toContain("<select");
  });

  it("groups every fixed troop type and rank with nation portraits and rank badges", () => {
    const soldiers = (["shield", "heavy", "archer", "cavalry"] as const).flatMap(type =>
      [0, 1, 2].map(rank => ({
        actor: rank + 1, health: 100, maximumHealth: 100,
        phase: "militaryReserve", rank, type
      })));
    const groups = getSoldierGroups(soldiers, "viking");
    expect(groups).toHaveLength(12);
    expect(groups[0]).toMatchObject({ count: "1", key: "shield-0", rankBadge: "I", type: "shield" });
    expect(groups[11]).toMatchObject({ key: "cavalry-2", rankBadge: "III", type: "cavalry" });
    expect(new Set(groups.map(group => group.icon)).size).toBe(10);
    for (const type of ["shield", "heavy", "archer"])
      expect(new Set(groups.filter(group => group.type === type).map(group => group.icon)).size).toBe(3);
    expect(groups.every(group => group.title.includes("HP"))).toBe(true);
    expect(getSoldierGroups(soldiers, "roman")[0]?.icon).not.toBe(groups[0]?.icon);
    const travelling = getSoldierGroups([
      ...soldiers.slice(0, 1),
      { ...soldiers[0]!, actor: 99, phase: "militaryField" }
    ], "viking");
    expect(travelling).toHaveLength(1);
    expect(travelling[0]?.count).toBe("1");
  });

  it("renders the settlers page with portraits and job tool badges", () => {
    const markup = renderWithI18n(createElement(WorkforceSection, {
      availableSettlers: 2, workforce: { Carrier: 3, Woodcutter: 1, Smith: 1 }
    }));
    expect(markup).toContain('class="settlement-ui__inventory settlement-ui__workforce-inventory"');
    expect(markup).toContain('aria-label="Carriers: 3" data-count="3" data-job="Carrier"');
    expect(markup).toContain('data-job="available"');
  });

  it("renders a construction site with its materials and only the Demolish action", () => {
    const markup = render(building({ completed: false, construction: { consumed: {}, foundationProgress: 1,
      incoming: {}, progress: .5, required: { planks: 2 } }, type: 37 }));
    expect(markup).toContain(" · Under construction");
    expect(markup).toContain('<section aria-label="Construction details" class="settlement-ui__construction">');
    expect(markup).toContain('<progress aria-label="Construction progress" max="1" value="0.5">');
    expect(markup).toContain("<caption>Construction materials</caption>");
    expect(markup).toContain('data-demolish-building="7"');
    expect(markup).not.toContain("data-production-pause");
  });

  it("shows all ten Monument materials with canonical icons and exact required/delivered/incoming quantities", () => {
    const required = getConstructionCost(7);
    const subject = building({ completed: false, construction: { consumed: { hardwoodPlanks: 3 },
      foundationProgress: 1, incoming: { granite: 2 }, progress: .25, required },
      input: { hardwoodPlanks: 4 }, type: 7 });
    const details = getConstructionDetails(subject), markup = render(subject);
    expect(details.materials).toHaveLength(10);
    expect(details.materials.find(material => material.ware === "hardwoodPlanks")).toMatchObject({ delivered: "7", required: "20" });
    expect(details.materials.find(material => material.ware === "granite")).toMatchObject({ incoming: "2", required: "20" });
    expect(markup.match(/<td>20<\/td>/g)).toHaveLength(10);
    for (const ware of Object.keys(required)) expect(markup).toContain(getWareIconSource(ware));
    expect(markup).not.toContain("data-production-pause");
  });

  it("renders a producer with progress, wares, output choice, pause and upgrade", () => {
    const markup = render(building({ input: { iron: 1 }, output: {}, status: "Working", type: 25, worker: "Smith",
      workProgress: .42, workProgressLabel: "Forging" }));
    expect(markup).toContain('<p class="settlement-ui__section-description">Working · Smith</p>');
    expect(markup).toContain('<progress aria-label="Forging" aria-valuetext="Forging: 42%" '
      + 'class="settlement-ui__work-progress" max="1" title="Forging: 42%" value="0.42">');
    expect(markup).toContain('aria-label="Input wares"');
    expect(markup).toMatch(/aria-label="Choose output"[^>]*role="radiogroup"/);
    expect(markup).toMatch(/aria-label="Produce random tools" type="radio"[^>]*checked=""/);
    expect(markup).toContain('class="settlement-ui__output-choice-icon"');
    expect(markup).toContain('data-ware="randomTools"');
    expect(markup).toContain('class="settlement-ui__output-choice-icon settlement-ui__ware-group-random-icon"');
    expect(markup).toContain("<small>Random tools</small>");
    expect(markup).toContain('aria-label="Stop" aria-pressed="false"');
    expect(markup).toContain('data-production-pause="7"');
    expect(markup).toContain('data-workshop-upgrade="7"');
    expect(markup).toContain('aria-label="Upgrade"');
    expect(markup).not.toContain('class="settlement-ui__upgrade"');
    expect(markup).toContain('role="tooltip"');
  });

  it("renders armory orders with read-only counts", () => {
    const markup = render(building({ productionOrders: { shield: 2 }, type: 24 }));
    expect(markup).toContain('data-production-ware="shield"');
    expect(markup).toContain('data-production-ware="bow"');
    expect(markup).not.toContain('data-production-ware="armor"');
    expect(markup).toContain('<output aria-label="Shield remaining">2</output>');
    expect(markup).toContain('aria-label="Unlimited sword production" aria-pressed="true"');
    expect(markup).toContain('aria-label="Produce one fewer shield"');
  });

  it("renders sawmill recipes and both explicit shipyard products", () => {
    const sawmill = render(building({ type: 33 }));
    expect(sawmill).toContain('aria-label="Choose output" role="radiogroup"');
    expect(sawmill).toMatch(/aria-label="Produce softwood planks" type="radio"[^>]*checked=""/);
    const radios = sawmill.match(/<input[^>]*type="radio"[^>]*>/g)!;
    expect(radios).toHaveLength(6);
    expect(radios.filter(radio => radio.includes('disabled=""'))).toHaveLength(4);
    expect(radios.filter(radio => radio.includes('checked=""'))).toHaveLength(1);
    expect(new Set(radios.map(radio => /name="([^"]+)"/.exec(radio)?.[1])).size).toBe(1);
    const upgraded = render(building({ selectedOutput: "hardwoodPlanks", type: 33, workshopUpgrade: { level: 1 } }));
    expect(upgraded).toMatch(/aria-label="Produce hardwood planks" type="radio"[^>]*checked=""/);
    const carts = render(building({ sawmillMode: "handcart", selectedOutput: "hardwoodPlanks", type: 33,
      workshopUpgrade: { level: 1 } }));
    expect(carts).toMatch(/aria-label="Produce hand carts"[^>]*checked=""/);
    expect(carts.match(/<input[^>]*checked=""/g)).toHaveLength(1);
    expect(carts).toContain("Needs 4 softwood logs");
    for (const mode of ["boats", "ships"] as const) {
      const markup = render(building({ shipyardMode: mode, type: 36 }));
      expect(markup).toContain(`aria-label="Produce boats" aria-pressed="${mode === "boats"}"`);
      expect(markup).toContain(`aria-label="Produce ships" aria-pressed="${mode === "ships"}"`);
      expect(markup).toContain('aria-label="Shipyard product"');
      expect(markup).toContain('data-count="0" data-ware="planks"');
      expect(markup).not.toContain('data-ware="ship"');
      expect(markup).not.toContain("click to produce ships");
      const flow = markup.slice(markup.indexOf('aria-label="Production wares"'));
      expect(flow.indexOf('aria-label="Input wares"')).toBeLessThan(flow.indexOf('aria-label="Shipyard product"'));
      expect(flow.indexOf('aria-label="Shipyard product"')).toBeLessThan(flow.indexOf("</section>"));
    }
  });

  it("renders farm, stonemason and quarry notes", () => {
    expect(render(building({ farmGrowing: 2, type: 37 }))).toContain('data-farm-uid="7"');
    expect(render(building({ type: 19 }))).toContain('data-stone-uid="7"');
    expect(render(building({ marbleRemaining: 9, type: 43 }))).toContain("9 blocks remaining on this island.");
  });

  it("renders the garrison, soldier roster and Tavern sections", () => {
    const markup = render(building({
      garrison: garrisonSummary({ assigned: counts(1), stationed: counts(1), stored: counts(1),
        coinIncoming: 1, coinStock: 5, coinsAllowed: false, drinkIncoming: 1, drinkStock: 2,
        stationedByRank: { archer: [0, 0, 0], heavy: [0, 0, 0], shield: [1, 0, 0] } }),
      soldiers: [{ actor: 4, health: 9, maximumHealth: 10, phase: "garrison",
        rank: 0, type: "shield" }],
      tavern: { current: null, freeSettlers: 0, queue: [] },
      type: 1
    }), { resources: { sword: 1 } });
    expect(markup).toContain('<section aria-label="Garrison" class="settlement-ui__garrison">');
    expect(markup).toContain('aria-label="Military supplies"');
    expect(markup).toContain('aria-label="Coin deliveries stopped. Click to allow new coin deliveries."');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('class="settlement-ui__garrison-coin-x"');
    expect(markup).toContain('<output aria-label="Coins stored here">5</output>');
    expect(markup).toContain('data-garrison-drink="wine"');
    expect(markup).toContain('<output aria-label="Wine stored here">2</output>');
    expect(markup.match(/>1 on the way</g)).toHaveLength(2);
    expect(markup).toContain('data-garrison-inside="shield-0"');
    expect(markup).toContain('aria-label="1 Swordsman, Recruit"');
    expect(markup).toContain('<output aria-label="Swordsmen wanted">1</output>');
    expect(markup).toContain('<select aria-label="Training focus">');
    expect(markup).toContain("One coin and one wine promote one stationed soldier by one rank.");
    expect(markup).toContain('class="settlement-ui__soldier-row" data-rank="0"');
    expect(markup).toContain("Swordsman #5 · Recruit · 9/10 HP · Stationed");
    expect(markup).toContain('data-rank-level="1"');
    expect(markup).not.toContain("Equipment for soldier");
    expect(markup).not.toContain("Choose soldier equipment");
    expect(markup).not.toContain('value="cavalry"');
    expect(markup).toContain('data-tavern-troop="shield"');
    expect(markup).toContain('<output aria-label="Recruits to order">1</output>');
    expect(markup).toContain('class="settlement-ui__tavern-ingredient" data-enough="false"');
    expect(markup).toContain('data-tavern-order="shield"');
    expect(markup).toContain('data-tavern-schedule=""');
    expect(markup).toContain("No recruits are scheduled.");
  });

  it("renders the active recruit and scheduled batches in the Tavern box", () => {
    const markup = render(building({
      tavern: {
        current: { stage: "collect", type: "archer" }, freeSettlers: 4,
        queue: [{ count: 2, type: "archer" }, { count: 3, type: "shield" }]
      },
      type: 40
    }));
    expect(markup).toContain('aria-label="Scheduled recruits"');
    expect(markup).toContain('data-tavern-schedule-current="true"');
    expect(markup).toContain('data-tavern-schedule-entry="shield"');
    expect(markup).toContain("5 scheduled");
    expect(markup).toContain("2 × Archer");
    expect(markup).toContain("3 × Swordsman");
  });

  it("renders the harbour expedition actions with their preparation progress", () => {
    const markup = renderHarbourPage(building({ type: 39 }), {
      expeditionOngoing: true,
      expeditionPreparations: [{ builder: false, cargo: { planks: 2 }, crew: 1, id: 5, ready: false,
        shipAvailable: false, sourceUid: 7, status: "supplies" }]
    }, { ...commands, onOpenColonyPlanner: () => {} });
    expect(markup).toContain('data-harbour-exploration="7"');
    expect(markup).toMatch(/data-harbour-colony="7"[^>]*disabled=""|disabled=""[^>]*data-harbour-colony="7"/);
    expect(markup).toContain('data-expedition-preparation="5"');
    expect(markup).toContain("Planks 2/4");
    const withDemand = renderHarbourPage(building({ type: 39 }), {
      shippingDemands: [{ covered: 1, createdTick: 0, destinationUid: 7, fleet: 0, harbourUid: 7, id: 9,
        incoming: 0, need: 4, outstanding: 3, reason: "no-source", revision: 0, status: "outstanding",
        stock: 1, updatedTick: 0, ware: "planks" }]
    });
    expect(withDemand).toContain('data-harbour-demand="9"');
    expect(withDemand).toContain("Supply 3 Softwood planks: waiting for source stock");
  });

  it("disables potential settlement occupation while an expedition is active", () => {
    const markup = renderHarbourPage(building({ type: 39 }), {
      seaOrders: [{ destinationUid: 7, expedition: true, id: 3, passengers: 3, sourceUid: 7 }]
    }, {
      ...commands,
      onPotentialSettlements: () => [{ rotation: 0, water: { x: 281.5, z: 39.5 }, x: 297, z: 39 }],
      onQueueExpedition: () => true
    });
    expect(markup).toContain('data-potential-settlement="7"');
    expect(markup).toMatch(/data-potential-settlement="7"[^>]*disabled=""|disabled=""[^>]*data-potential-settlement="7"/);
    expect(markup).toContain("Finish or cancel the current expedition first");
  });

  it("hides or disables sea scouting from the authoritative availability without exposing sites", () => {
    const disabled = renderHarbourPage(building({ type: 39 }), {}, {
      ...commands, onScoutingAvailability: () => ({ hidden: false, ready: false, reason: "ship" })
    });
    expect(disabled).toMatch(/data-harbour-exploration="7"[^>]*disabled=""|disabled=""[^>]*data-harbour-exploration="7"/);
    expect(disabled).toContain('title="Waiting for an idle ship that can reach this harbour."');
    const hidden = renderHarbourPage(building({ type: 39 }), {}, {
      ...commands, onScoutingAvailability: () => ({ hidden: true, ready: false, reason: "noSites" })
    });
    expect(hidden).toMatch(/data-harbour-exploration="7"[^>]*hidden=""|hidden=""[^>]*data-harbour-exploration="7"/);
    expect(getScoutingView({ hidden: false, ready: false, reason: "spyglass" }))
      .toMatchObject({ disabled: true, title: "Needs a free spyglass at this harbour." });
    expect(getScoutingView({ hidden: false, ready: true })).toMatchObject({ disabled: false, hidden: false });
  });

  it("renders a read-only stepper and an info tooltip", () => {
    const stepper = renderToStaticMarkup(createElement(CountStepper, { count: "3", countLabel: "Count",
      decreaseDisabled: true, decreaseLabel: "Less", increaseLabel: "More", onDecrease: () => {},
      onIncrease: () => {} }));
    expect(stepper).toBe('<button aria-label="Less" disabled="" title="Less" type="button">−</button>'
      + '<output aria-label="Count">3</output><button aria-label="More" title="More" type="button">+</button>');
    const tooltip = renderToStaticMarkup(createElement(InfoTooltip, { label: "Upgrade benefits",
      lines: [{ text: "Level 2: faster" }, { marked: true, text: "Level 3: more (next)" }] }));
    expect(tooltip).toMatch(/<button aria-describedby="([^"]+)" aria-expanded="false" aria-label="Upgrade benefits"/);
    expect(tooltip).toMatch(/hidden="" id="[^"]+" role="tooltip"/);
    expect(tooltip).toContain('<p class="info-tooltip__line info-tooltip__line--marked">Level 3: more (next)</p>');
  });

  it("renders nothing without a focused building", () => {
    const store = createSettlementUiStore();
    expect(renderWithI18n(createElement(BuildingDetails, { options: commands, store, visibility: visible() })))
      .toBe("");
  });
});

import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createExternalStore, isDeepEqual } from "../src/app/components/ui-store";
import { BuildingRegister } from "../src/app/settlement-ui/building-register/building-register";
import {
  getBuildingRegisterCard, getBuildingRegisterGroups, getNextRegisterVisit, selectBuildingRegister
} from "../src/app/settlement-ui/building-register/helpers";
import { GemShop } from "../src/app/settlement-ui/gem-shop/gem-shop";
import {
  buyGemOffer, getGemShopOfferCards, getGemShopTabs, selectGemShopPlayer
} from "../src/app/settlement-ui/gem-shop/helpers";
import {
  getMessageTabs, getReportDetails, getSelectedReport, selectMessages, shouldMarkRead
} from "../src/app/settlement-ui/messages/helpers";
import { Messages } from "../src/app/settlement-ui/messages/message-view";
import { createOpenRequest } from "../src/app/settlement-ui/open-request";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import {
  getSummaryPeopleView, getSummaryResourceRows, isSameSummaryPeople, isSameSummaryResources,
  selectSummaryPeople, selectSummaryResources
} from "../src/app/settlement-ui/summary/helpers";
import { SettlementSummary } from "../src/app/settlement-ui/summary/settlement-summary";
import type { SettlementPlayerSummary, SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { createBattleMessage } from "../src/shared/progression/battle-messages";
import { renderWithI18n } from "./helpers/render-with-i18n";

const visible = () => createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true });
const storeWith = (snapshot: SettlementUiSnapshot) => {
  const store = createSettlementUiStore();
  store.update(snapshot);
  return store;
};
const player = (fields: Partial<SettlementPlayerSummary>) => fields as SettlementPlayerSummary;

describe("settlement overview", () => {
  it("orders goods, compacts large counts and hides locked materials", () => {
    const rows = getSummaryResourceRows({ level: 1, resources: { cedarLogs: 0, fish: 12_500, logs: 3 } });
    expect(rows.map(row => row.ware)).toEqual(["logs", "fish"]);
    expect(rows[1]).toMatchObject({ label: "Fish: 12500", value: "13K" });
  });

  it("treats a re-published stock with the same counts as unchanged", () => {
    const left = selectSummaryResources({ player: player({ level: 2 }), resources: { logs: 3 } });
    expect(isSameSummaryResources(left, { level: 2, resources: { logs: 3 } })).toBe(true);
    expect(isSameSummaryResources(left, { level: 2, resources: { logs: 4 } })).toBe(false);
    expect(isSameSummaryResources(left, { level: 3, resources: { logs: 3 } })).toBe(false);
  });

  it("groups workers and soldiers with civilian professions first", () => {
    const people = getSummaryPeopleView({
      availableSettlers: 4,
      militaryUnits: { archer: 2, shield: 1 },
      nation: "roman",
      population: 12,
      populationLimit: 30,
      workforce: { Carrier: 3, Woodcutter: 2 }
    });
    expect(people).toMatchObject({ idleSettlers: "4", population: "12 / 30" });
    expect(people.workers.map(row => [row.job, row.count]))
      .toEqual([["Carrier", "3"], ["Woodcutter", "2"]]);
    expect(people.military.map(row => [row.type, row.label, row.count]))
      .toEqual([["shield", "Swordsmen", "1"], ["archer", "Archers", "2"]]);
  });

  it("treats republished worker and soldier maps with equal counts as unchanged", () => {
    const left = selectSummaryPeople({
      availableSettlers: 2, militaryUnits: { archer: 1 }, player: player({ nation: "roman" }),
      population: 9, workforce: { Carrier: 2 }
    });
    expect(isSameSummaryPeople(left, {
      availableSettlers: 2, militaryUnits: { archer: 1 }, nation: "roman", population: 9,
      workforce: { Carrier: 2 }
    })).toBe(true);
    expect(isSameSummaryPeople(left, {
      availableSettlers: 2, militaryUnits: { archer: 2 }, nation: "roman", population: 9,
      workforce: { Carrier: 2 }
    })).toBe(false);
    expect(isSameSummaryPeople(left, {
      availableSettlers: 2, militaryUnits: { archer: 1 }, nation: "roman", population: 9,
      workforce: { Carrier: 1 }
    })).toBe(false);
  });

  it("renders goods and settlers tabs without the old counters", () => {
    const markup = renderWithI18n(createElement(SettlementSummary, {
      store: storeWith({
        availableSettlers: 4,
        militaryUnits: { archer: 2, shield: 1 },
        player: player({ level: 2, nation: "roman" }),
        population: 12,
        populationLimit: 30,
        resources: { logs: 36 },
        workforce: { Carrier: 3, Woodcutter: 2 }
      }),
      visibility: visible()
    }));
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain(">Goods</button>");
    expect(markup).toContain(">Settlers</button>");
    expect(markup).toContain('<div aria-label="Resources" class="settlement-ui__resources">');
    expect(markup).toContain('<span aria-label="Softwood logs: 36" title="Softwood logs: 36"><img');
    expect(markup).toContain("<small>Softwood logs</small><b>36</b>");
    expect(markup).not.toContain("settlement-ui__counters");
    expect(markup).toContain('<section aria-label="Settlers"');
    expect(markup).toContain('aria-label="Population: 12 / 30"');
    expect(markup).toContain('aria-label="Idle settlers: 4"');
    expect(markup).toContain('data-job="Carrier"');
    expect(markup).toContain('data-job="Woodcutter"');
    expect(markup).toContain('data-troop="archer"');
    expect(markup).toContain('data-troop="shield"');
  });
});

describe("building register", () => {
  const buildings = [
    { completed: true, id: "hq", type: 0 },
    { completed: true, id: "cut-a", type: 17 },
    { completed: true, id: "cut-b", type: 17 },
    { completed: false, id: "cut-site", type: 17 }
  ];

  it("cycles through a type's completed buildings and ignores types without any", () => {
    const register = selectBuildingRegister({ buildings });
    const woodcutter = register.find(entry => entry.id === 17)!;
    const visits = new Map<number, number>();
    expect([1, 2, 3].map(() => getNextRegisterVisit(woodcutter, visits))).toEqual(["cut-a", "cut-b", "cut-a"]);
    expect(getNextRegisterVisit(register.find(entry => entry.id === 31)!, visits)).toBeUndefined();
  });

  it("is unchanged while counts and names stay the same", () => {
    const register = selectBuildingRegister({ buildings });
    expect(isDeepEqual(register, selectBuildingRegister({ buildings: [...buildings] }))).toBe(true);
    expect(isDeepEqual(register, selectBuildingRegister({ buildings: buildings.slice(1) }))).toBe(false);
  });

  it("labels a card with built and under-construction counts", () => {
    const card = getBuildingRegisterCard(selectBuildingRegister({ buildings }).find(entry => entry.id === 17)!);
    expect(card).toMatchObject({ built: "2", disabled: false, sites: "1" });
    expect(card.label).toMatch(/: 2 built, 1 under construction$/);
  });

  it("groups cards under the current functional building categories", () => {
    const groups = getBuildingRegisterGroups(selectBuildingRegister({ buildings }));
    expect(groups.map(group => group.label)).toEqual(["Materials", "Settlement", "Food", "Industry", "Mines", "Military"]);
    expect(groups.find(group => group.id === "materials")!.entries.map(entry => entry.id)).toContain(17);
    expect(groups.find(group => group.id === "food-drink")!.entries.map(entry => entry.id)).toContain(31);
    expect(groups.find(group => group.id === "mines")!.entries.map(entry => entry.id)).toEqual(
      expect.arrayContaining([10, 11, 12, 13]));
  });

  it("renders a card per type with data-building-type and its counts", () => {
    const markup = renderWithI18n(createElement(BuildingRegister, {
      actions: { close: vi.fn(), onFocus: vi.fn() }, store: storeWith({ buildings }), visibility: visible()
    }));
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain(">Materials</button>");
    expect(markup).toContain(">Settlement</button>");
    expect(markup).toContain(">Food</button>");
    expect(markup).toContain(">Mines</button>");
    expect(markup).toContain('<div aria-label="Materials" class="settlement-ui__building-register-grid">');
    expect(markup).toContain('class="settlement-ui__card settlement-ui__building-register-card" '
      + 'data-building-type="17" data-completed="2" data-sites="1"');
    expect(markup).toMatch(/data-building-type="31" data-completed="0" data-sites="0" disabled=""/);
    expect(markup).toContain('<b title="Built">2</b><small title="Under construction">1</small>');
  });
});

describe("battle report inbox", () => {
  const report = createBattleMessage({
    battle: { buildings: [{ bandit: { code: 1, layout: 0 }, type: 4, uid: 50 }], defeated: { shield: 8 }, lost: {}, sent: { archer: 4, shield: 12 } },
    buildings: [], date: 0, experience: 80, goods: { stone: 20 }, island: { name: "Stormcairn", seed: 3 },
    kind: "adventure", nation: "roman"
  });
  const read = { ...report, id: "read", island: "Old Bay", kind: "colony" as const, read: true };

  it("shows the selected report, else the newest, and marks each unread report once", () => {
    expect(getSelectedReport([report, read], "read")).toBe(read);
    expect(getSelectedReport([report, read], "gone")).toBe(report);
    expect(getSelectedReport([], "")).toBeUndefined();
    expect(shouldMarkRead(report, new Set())).toBe(true);
    expect(shouldMarkRead(report, new Set([report.id]))).toBe(false);
    expect(shouldMarkRead(read, new Set())).toBe(false);
    expect(selectMessages({})).toBe(selectMessages({}));
  });

  it("prepares tabs and the report's troop, building and reward tiles", () => {
    expect(getMessageTabs([report, read], report.id)).toEqual([
      { className: "settlement-ui__tab is-unread", id: report.id, pressed: true, title: "Adventure completed: Stormcairn" },
      { className: "settlement-ui__tab", id: "read", pressed: false, title: "Colony conquered: Old Bay" }
    ]);
    const details = getReportDetails(report);
    expect(details.sections.map(section => section.tiles.map(tile => `${tile.label} ${tile.count}`))).toEqual([
      ["Swordsmen 12", "Archers 4"], [], ["Shield soldiers 8"], ["Archer scaffold 1"], ["Stone 20"]
    ]);
    expect(details.sections[2]!.tiles[0]!.icon).toEqual({ kind: "ware", ware: "shield" });
    expect(details).toMatchObject({ experience: "80 XP", rewardsTravelHome: true });
  });

  it("renders the report list and details", () => {
    const markup = renderWithI18n(createElement(Messages, {
      request: createOpenRequest(), store: storeWith({ player: player({ messages: [report] }) }), visibility: visible(),
      onReadMessage: vi.fn()
    }));
    expect(markup).toContain('<nav aria-label="Battle reports"><button aria-pressed="true" class="settlement-ui__tab is-unread"');
    expect(markup).toContain('<article class="message-window__details"><h2>Stormcairn</h2>');
    expect(markup).toContain("<h3>Your losses</h3><div class=\"message-window__tiles\"><p>None</p></div>");
    expect(markup).toContain('<div class="message-window__tile" title="Archers"><img alt=""');
    expect(markup).toContain("<small>Reward wares travel home aboard the returning ship.</small>");
  });

  it("explains an empty inbox", () => {
    const markup = renderWithI18n(createElement(Messages,
      { request: createOpenRequest(), store: storeWith({}), visibility: visible() }));
    expect(markup).toContain("No messages yet. Completed adventures and colony conquests appear here.");
  });
});

describe("gem shop", () => {
  it("lists a category's offers, hides locked tiers and disables what the balance cannot pay", () => {
    const low = getGemShopOfferCards(0, { gems: 5, level: 1 });
    const high = getGemShopOfferCards(0, { gems: 5, level: 99 });
    expect(low).toHaveLength(high.length);
    expect(low.some(card => card.resourceTier !== undefined)).toBe(true);
    const tools = getGemShopOfferCards(2, { gems: 180, level: 1 });
    expect(tools).toHaveLength(13);
    expect(tools.find(card => card.id === "bow-10")).toMatchObject({ disabled: false });
    expect(tools.find(card => card.id === "spyglass-10")).toMatchObject({ disabled: false });
    expect(getGemShopOfferCards(2, { gems: 0, level: 1 }).every(card => card.disabled)).toBe(true);
  });

  it("selects balance and level, with defaults for a missing player", () => {
    expect(selectGemShopPlayer({})).toEqual({ closed: false, gems: 0, inventory:undefined, level: 1 });
    expect(selectGemShopPlayer({ player: player({ gems: 7, level: 3 }) }))
      .toEqual({ closed: false, gems: 7, inventory:undefined, level: 3 });
  });

  it("returns the purchase result synchronously, or why the shop is unavailable", () => {
    const onBuyGemOffer = vi.fn(() => "Needs 3 more gems" as const);
    expect(buyGemOffer({ onBuyGemOffer }, "bow-10")).toBe("Needs 3 more gems");
    expect(onBuyGemOffer).toHaveBeenCalledWith("bow-10");
    expect(buyGemOffer({}, "bow-10")).toBe("The gem shop is unavailable");
  });

  it("prepares roving category tabs", () => {
    expect(getGemShopTabs(1).map(({ selected, tabId, tabIndex }) => ({ selected, tabId, tabIndex }))).toEqual([
      { selected: false, tabId: "gem-shop-tab-resources", tabIndex: -1 },
      { selected: true, tabId: "gem-shop-tab-military", tabIndex: 0 },
      { selected: false, tabId: "gem-shop-tab-tools", tabIndex: -1 },
      { selected: false, tabId: "gem-shop-tab-items", tabIndex: -1 },
      { selected: false, tabId: "gem-shop-tab-decorations", tabIndex: -1 }
    ]);
  });

  it("renders categories, offer cards and the balance without a duplicate purchase status", () => {
    const markup = renderWithI18n(createElement(GemShop, {
      options: { onBuyGemOffer: () => true as const, onPreviewDecoration: () => undefined }, store: storeWith({ player: player({ gems: 1234, level: 1 }) }),
      visibility: visible()
    }));
    expect(markup).toContain('<div aria-label="Shop categories" class="gem-shop__categories" role="tablist">');
    expect(markup).toContain('aria-selected="true" class="settlement-ui__tab gem-shop__category" id="gem-shop-tab-resources"');
    expect(markup).toContain('class="gem-shop__catalog" id="gem-shop-offers" role="tabpanel"');
    expect(markup).toContain('<article class="settlement-ui__card gem-shop__offer" data-offer-id="logs-100" data-resource-tier="0">');
    expect(markup).toContain("<br/><small>Tier 0 building material</small>");
    expect(markup).toMatch(/<button aria-label="Buy 100 [^"]+ for \d+ gems" class="settlement-ui__button gem-shop__buy"/);
    expect(markup).toContain('<p class="gem-shop__balance">Your gems: <img alt="" class="gem-shop__gem"');
    expect(markup).toContain("/>1,234</p>");
    expect(markup).not.toContain('gem-shop__status');
  });
});

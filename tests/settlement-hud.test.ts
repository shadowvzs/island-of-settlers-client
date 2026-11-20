import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createExternalStore, isDeepEqual } from "../src/app/components/ui-store";
import { BottomBar } from "../src/app/settlement-ui/hud/bottom-bar";
import { getLauncherRows, getPlacementStrip, selectBottomBar, selectPlacement } from "../src/app/settlement-ui/hud/helpers";
import { PlacementStrip } from "../src/app/settlement-ui/hud/placement-strip";
import {
  BUILDING_PICKER_GROUPS, getBuildingCardGroups, getBuildToolRows, getRoadCardRows, getRoadLockLevel,
  getSelectionDetail, selectBuildingPicker,
  selectBuildTools
} from "../src/app/settlement-ui/main-panel/build-helpers";
import { BuildView } from "../src/app/settlement-ui/main-panel/build-view";
import { getMenuEntries, selectNoticeRows } from "../src/app/settlement-ui/main-panel/helpers";
import type { MainPanelView, MainPanelVisibility } from "../src/app/settlement-ui/main-panel/main-panel";
import { MenuView } from "../src/app/settlement-ui/main-panel/menu-view";
import { NoticesView } from "../src/app/settlement-ui/main-panel/notices-view";
import {
  getPortraitSize, getPortraitToggle, isSamePlayerHud, selectPlayerHud
} from "../src/app/settlement-ui/player-hud/helpers";
import { PlayerHud } from "../src/app/settlement-ui/player-hud/player-hud";
import type { SettlementPlayerSummary, SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { renderWithI18n } from "./helpers/render-with-i18n";

const storeWith = (snapshot: SettlementUiSnapshot) => {
  const store = createSettlementUiStore();
  store.update(snapshot);
  return store;
};
const panelOn = (view: MainPanelView) => createExternalStore<MainPanelVisibility>({ opened: 1, view, visible: true });
const noop = vi.fn();

const player = (fields: Partial<SettlementPlayerSummary> = {}): SettlementPlayerSummary => ({
  current: 40,
  experience: 140,
  fraction: 0.4,
  gems: 1250,
  level: 2,
  nation: "roman",
  needed: 100,
  quests: [],
  stock: {},
  talents: {},
  ...fields
});

describe("bottom bar", () => {
  it("offers Build, Inventory, Map, Menu, News and Support with the blocked build title, map state and news count", () => {
    const rows = getLauncherRows(selectBottomBar({
      buildingMenuBlocked: true, minimapVisible: true, notifications: [{ id: "a", message: "Hi" }]
    }));
    expect(rows.map(row => row.label)).toEqual(["Build", "Inventory", "Map", "Menu", "News", "Support"]);
    expect(rows[0]).toMatchObject({ disabled: true, title: "Conquer this colony to unlock building" });
    expect(rows[2]!.pressed).toBe(true);
    expect(rows[3]!.pressed).toBeUndefined();
    expect(rows[4]!.title).toBe("Notifications (1)");
  });

  it("offers the Campaign launcher before News on the home island only, when the session has campaigns", () => {
    const ids = (homeIsland: boolean, campaign: boolean) =>
      getLauncherRows(selectBottomBar({ homeIsland }), undefined, campaign).map(row => row.id);
    expect(ids(true, true)).toEqual(["build", "inventory", "map", "menu", "campaign", "news", "support"]);
    expect(ids(false, true)).toEqual(["build", "inventory", "map", "menu", "news", "support"]);
    expect(ids(true, false)).toEqual(["build", "inventory", "map", "menu", "news", "support"]);
    const campaign = getLauncherRows(selectBottomBar({ homeIsland: true }), undefined, true)[4]!;
    expect(campaign).toMatchObject({ anchor: "bottomBar.campaign", icon: "campaign", label: "Campaign",
      title: "Campaign" });
  });

  it("renders icon-only launchers with their accessible names and classes", () => {
    const markup = renderWithI18n(createElement(BottomBar, { campaign: false, store: storeWith({}), onLauncher: noop }));
    expect(markup).toContain('<button aria-haspopup="dialog" aria-label="Build" class="settlement-ui__button ' +
      'settlement-ui__launcher settlement-ui__button--primary" data-launcher-id="build" data-ui-anchor="bottomBar.build" ' +
      'title="Build" type="button"><svg');
    expect(markup).toContain('aria-label="Map" aria-pressed="false" class="settlement-ui__button settlement-ui__launcher"');
    expect(markup).toContain('aria-label="News" class="settlement-ui__button settlement-ui__launcher" data-launcher-id="news" ' +
      'data-ui-anchor="bottomBar.news" title="Notifications (0)"');
    expect(markup).toContain('aria-label="Support" class="settlement-ui__button settlement-ui__launcher" ' +
      'data-launcher-id="support" data-ui-anchor="bottomBar.support" title="Support"');
    expect(markup.lastIndexOf('data-launcher-id="support"')).toBeGreaterThan(markup.lastIndexOf('data-launcher-id="news"'));
    expect(markup).not.toContain("<span>");
  });
});

describe("main panel menu", () => {
  it("lists the Main selection entries without save controls", () => {
    expect(getMenuEntries().map(entry => entry.label))
      .toEqual(["Buildings", "Overview", "Ships", "Market", "Settings"]);
  });

  it("has no save line, Save now or Export / Import controls", () => {
    const markup = renderWithI18n(createElement(MenuView, { onMenuEntry: noop, shortcuts: [] }));
    expect(markup).not.toContain("Not saved yet");
    expect(markup).not.toContain('aria-label="Save now"');
    expect(markup).not.toContain("Export game");
    expect(markup).not.toContain("Import game");
  });

  it("renders captioned buttons; Ships keeps its tooltip", () => {
    const markup = renderWithI18n(createElement(MenuView, { onMenuEntry: noop, shortcuts: [] }));
    expect(markup).toContain('aria-label="Ships" class="settlement-ui__button" title="Ships on this island"');
    expect(markup).toContain("<span>Settings</span>");
  });

  it("ends with the window shortcuts as dialog openers after Settings", () => {
    const shortcuts = ["Music player", "Credits", "Game News", "Language"]
      .map(caption => ({ caption, icon: "scroll", open: noop, registerOpener: noop }));
    const markup = renderWithI18n(createElement(MenuView, { onMenuEntry: noop, shortcuts }));
    expect(markup.indexOf("<span>Settings</span>")).toBeLessThan(markup.indexOf("<span>Music player</span>"));
    expect(markup).toContain('<button aria-haspopup="dialog" aria-label="Credits" class="settlement-ui__button"');
    expect(markup).toContain("<span>Game News</span>");
    expect(markup).toContain("<span>Language</span>");
  });
});

describe("build view", () => {
  it("offers every road image-card model including bridges and the verge card, and retains removal " +
    "and surveying utilities", () => {
    const roads = getRoadCardRows(selectBuildTools({ player: player({ level: 46 }), roadMode: "marble" }));
    expect(roads.map(row => row.label)).toEqual([
      "Dirt road", "Stone road", "Marble road", "Limestone road", "Basalt road", "Granite road",
      "Wooden bridge", "Stone bridge", "Roadside flowers"
    ]);
    expect(roads.filter(row => row.pressed).map(row => row.id)).toEqual(["marble"]);
    expect(roads[2]).toMatchObject({ locked: false, lockText: null, speed: "120% walking speed" });
    expect(roads[2]!.title).toMatch(/^Upgrade stone → marble: 120% walking speed/);
    expect(roads[6]).toMatchObject({ id: "bridge-wood", locked: false, speed: "2.6 deck · 2 lanes" });
    expect(roads[6]!.title).toContain("1 plank + 2 logs per tile");
    expect(roads[7]).toMatchObject({ id: "bridge-stone", locked: false });
    expect(roads[7]!.title).toContain("2 stone + 1 plank per tile");
    expect(roads[8]).toMatchObject({ id: "verge-flowers", locked: false });
    expect(getBuildToolRows(selectBuildTools({}), true).map(row => row.label))
      .toEqual(["Remove road"]);
    expect(getBuildToolRows(selectBuildTools({ surveyJob: "Scout" }), false).map(row => row.id)).not.toContain("Scout");
    expect(getBuildToolRows(selectBuildTools({ surveyJob: "Scout" }), true).map(row => row.id)).not.toContain("Geologist");
  });

  it("locks only advanced roads at the existing resource-level boundaries, independently of stock and colonies", () => {
    for (const tier of ["dirt", "stone"] as const) expect(getRoadLockLevel(tier, 1)).toBeUndefined();
    for (const [tier, required] of [["marble", 18], ["limestone", 22], ["basalt", 26], ["granite", 28]] as const) {
      expect(getRoadLockLevel(tier, required - 1)).toBe(required);
      expect(getRoadLockLevel(tier, required)).toBeUndefined();
    }
    const roads = getRoadCardRows(selectBuildTools({ player: player({ level: 14, stock: { granite: 999 } }) }));
    expect(roads.find(row => row.id === "limestone")).toMatchObject({ locked: true, lockText: "Lv 22",
      className: "settlement-ui__card settlement-ui__card--locked",
      title: "Limestone road · Requires level 22 (you are level 14)" });
    expect(getRoadCardRows(selectBuildTools({ player: player({ level: 46, stock: {} }) }))
      .every(row => !row.locked)).toBe(true);
  });

  it("leaves the headquarters out, names cards per nation and hides types a colony does not offer", () => {
    const allIds = BUILDING_PICKER_GROUPS.flatMap(group => group.buildings.map(building => building.id));
    expect(allIds).not.toContain(0);
    const groups = getBuildingCardGroups(selectBuildingPicker({ buildableTypes: [17], selectedBuilding: 17 }));
    const cards = groups.flatMap(group => group.cards);
    expect(cards.find(card => card.id === 17)).toMatchObject({ hidden: false, name: "Woodcutter", pressed: true });
    expect(cards.filter(card => !card.hidden)).toHaveLength(1);
    expect(getSelectionDetail(selectBuildingPicker({}))).toBe("Choose a building, then place it on the island.");
    expect(getSelectionDetail(selectBuildingPicker({ selectedBuilding: 17 }))).toMatch(/^Woodcutter · /);
  });

  it("greys a locked card with its level badge and requirement", () => {
    const picker = selectBuildingPicker({ lockedBuildings: "37:4,9:11", player: { level: 2 } as never });
    const cards = getBuildingCardGroups(picker).flatMap(group => group.cards);
    expect(cards.find(card => card.id === 37)).toMatchObject({ className: "settlement-ui__card settlement-ui__card--locked",
      lockText: "Lv 4", locked: true, title: "Farm · Requires level 4 (you are level 2)" });
    expect(cards.find(card => card.id === 17)).toMatchObject({ lockText: null, locked: false });
    expect(getSelectionDetail(picker, "Requires level 4 (you are level 2)")).toBe("Requires level 4 (you are level 2)");
  });

  it("treats a re-published equal allowed list as unchanged", () => {
    expect(selectBuildingPicker({ buildableTypes: [1, 17] })).toEqual(selectBuildingPicker({ buildableTypes: [1, 17] }));
  });

  it("renders Roads before the initially selected building category, with large road cards and utilities", () => {
    const markup = renderWithI18n(createElement(BuildView, {
      canSurvey: true,
      panel: panelOn("build"),
      store: storeWith({ roadMode: "dirt", selectedBuilding: null }),
      onHomeSandbox: noop,
      onPickBuilding: noop,
      onRoadTool: noop,
      onSurveyJob: noop
    }));
    expect(markup).not.toContain('aria-label="Roads and island tools"');
    expect(markup).not.toContain('aria-label="Scout"');
    expect(markup).not.toContain('aria-label="Geologist"');
    const firstCategory = BUILDING_PICKER_GROUPS[0]!.name;
    expect(markup.indexOf('role="tab" tabindex="-1" type="button">Roads</button>'))
      .toBeLessThan(markup.indexOf(`role="tab" tabindex="0" type="button">${firstCategory}</button>`));
    expect(markup).toContain('aria-disabled="false" aria-label="Dirt road" aria-pressed="true"');
    expect(markup).toContain('aria-disabled="true" aria-label="Granite road"');
    expect(markup).toContain('data-road="granite"');
    expect(markup).toContain('<span class="settlement-ui__card-lock">Lv 28</span>');
    expect(markup).toContain('aria-label="Stone road"');
    expect(markup).toContain('data-road="bridge-wood"');
    expect(markup).toContain('data-road="bridge-stone"');
    expect(markup).toContain('data-road="verge-flowers"');
    expect((markup.match(/data-road="/g) ?? []).length).toBe(9);
    expect(markup).toContain('<div aria-label="Building categories" class="settlement-ui__tabs" role="tablist">');
    expect(markup).toContain('aria-selected="true" class="settlement-ui__tab"');
    expect(markup).toContain('aria-pressed="false" class="settlement-ui__card" data-building="17"');
    expect(markup).toContain('<p class="settlement-ui__selection-detail">Choose a building');
  });
});

describe("placement strip", () => {
  it("names the active tool", () => {
    const name = (snapshot: SettlementUiSnapshot) => getPlacementStrip(selectPlacement(snapshot)).name;
    expect(name({ surveyJob: "Geologist" })).toBe("Send Geologist");
    expect(name({ roadMode: "remove" })).toBe("Remove road section");
    expect(name({ roadMode: "dirt" })).toBe("Build dirt road");
    expect(name({ roadMode: "granite" })).toBe("Granite road upgrade");
    expect(name({ selectedBuilding: 17 })).toBe("Place Woodcutter");
    expect(getPlacementStrip(selectPlacement({ roadMode: null, selectedBuilding: null })).hidden).toBe(true);
  });

  it("shows Rotate only while a building is placed", () => {
    const render = (snapshot: SettlementUiSnapshot) => renderWithI18n(createElement(PlacementStrip, {
      store: storeWith(snapshot), onCancel: noop, onRotate: noop
    }));
    expect(render({ selectedBuilding: 17 })).toContain('aria-label="Rotate selected building"');
    expect(render({ roadMode: "dirt" })).not.toContain("Rotate");
    expect(render({})).toContain('<div class="settlement-ui__placement" hidden="">');
  });
});

describe("notices", () => {
  const snapshot: SettlementUiSnapshot = {
    buildings: [{ id: "7", type: 17 }],
    notifications: [
      { buildingId: "7", buildingName: "Woodcutter", id: "n1", message: "The Woodcutter has no trees.", tone: "warning" },
      { buildingId: "9", buildingName: "Quarry", id: "n2", message: "Quarry exhausted." },
      { id: "n3", message: "Welcome." }
    ]
  };

  it("links a named building while it exists", () => {
    const rows = selectNoticeRows(snapshot);
    expect(rows[0]).toMatchObject({ after: " has no trees.", before: "The ", title: "Attention needed" });
    expect(rows[0]!.link).toEqual({ buildingId: "7", disabled: false, name: "Woodcutter", title: "Go to Woodcutter" });
    expect(rows[1]!.link).toMatchObject({ disabled: true, title: "Building no longer exists" });
    expect(rows[2]).toMatchObject({ before: "Welcome.", title: "Settlement news" });
    expect(rows[2]).not.toHaveProperty("link");
    expect(isDeepEqual(rows, selectNoticeRows({ ...snapshot, buildings: [{ id: "7", type: 17 }] }))).toBe(true);
    expect(isDeepEqual(rows, selectNoticeRows({ ...snapshot, buildings: [] }))).toBe(false);
  });

  it("renders the rows with the building link, or the empty text", () => {
    const render = (state: SettlementUiSnapshot) => renderWithI18n(createElement(NoticesView, {
      panel: panelOn("notices"), store: storeWith(state), onFocusBuilding: noop
    }));
    expect(render(snapshot)).toContain('<small>The <button class="settlement-ui__notification-building" ' +
      'title="Go to Woodcutter" type="button">Woodcutter</button> has no trees.</small>');
    expect(render({})).toContain('<p class="settlement-ui__empty">No new notifications.</p>');
  });
});

describe("player HUD", () => {
  it("prepares labels and badges", () => {
    const model = selectPlayerHud({ player: player({
      messages: [{ read: false }, { read: true }] as unknown as SettlementPlayerSummary["messages"],
      quests: [{ amount: 1, done: false, experience: 5, id: "q", kind: "deliver", progress: 0, reward: {}, ware: "logs" }],
      stock: { logs: 3 }
    }) })!;
    expect(model).toMatchObject({
      experienceFill: "40%", experienceText: "40 / 100 XP", gems: "1,250", inboxLabel: "Messages: 1 unread",
      level: "2", questClassName: "player-hud__quests is-ready", questLabel: "Quests: 1 ready to claim"
    });
    expect(selectPlayerHud({})).toBeNull();
    expect(selectPlayerHud({ player: player(), population: 54, populationLimit: 100 })).toMatchObject({
      populationLabel: "Population: 54 people of at most 100. While below the limit the headquarters gains a " +
        "settler every 60 seconds",
      populationText: "54 / 100"
    });
    expect(selectPlayerHud({ player: player(), population: 7 })!.populationText).toBe("7");
    expect(selectPlayerHud({ player: player({ needed: 0 }) })!.experienceText).toBe("140 XP · max level");
  });

  it("marks new quests and keeps an equal re-published player unchanged", () => {
    expect(selectPlayerHud({ player: player({ questNew: true }) })!.questClassName).toBe("player-hud__quests is-new");
    const left = selectPlayerHud({ player: player() });
    expect(isSamePlayerHud(left, selectPlayerHud({ player: player() }))).toBe(true);
    expect(isSamePlayerHud(left, selectPlayerHud({ player: player({ gems: 1 }) }))).toBe(false);
    expect(isSamePlayerHud(null, null)).toBe(true);
  });

  it("snaps the portrait to device pixels and labels the toggle", () => {
    expect(getPortraitSize(false, 1.25)).toBe("92px");
    expect(getPortraitSize(true, 1.5)).toBe(`${Math.round(72 * 1.5) / 1.5}px`);
    expect(getPortraitSize(false, 1.3)).toBe(`${Math.round(92 * 1.3) / 1.3}px`);
    expect(getPortraitToggle(true, "Level 2")).toEqual({
      label: "Show portrait", title: "Level 2 · click to show the portrait"
    });
  });

  it("renders the corner with the existing player-hud classes and names", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const markup = renderWithI18n(createElement(PlayerHud, {
      store: storeWith({ player: player() }),
      onOpenMessages: noop, onOpenQuests: noop, onOpenShop: noop, onOpenTalents: noop
    }));
    expect(markup).toContain('<aside aria-label="Player" class="player-hud">');
    expect(markup).toContain('aria-label="Open daily quests" class="player-hud__portrait"');
    expect(markup).toContain("--portrait-size:92px");
    expect(markup).toContain('aria-label="Hide portrait" aria-pressed="false" class="player-hud__experience"');
    const experienceStart = markup.indexOf('class="player-hud__experience"');
    const levelStart = markup.indexOf('class="player-hud__level"');
    const bodyStart = markup.indexOf('class="player-hud__experience-body"');
    expect(levelStart).toBeGreaterThan(experienceStart);
    expect(bodyStart).toBeGreaterThan(levelStart);
    expect(markup).toContain('<span class="player-hud__bar"><i style="width:40%"></i></span>');
    expect(markup).toContain('aria-label="Gems: open the gem shop" class="player-hud__gems"');
    expect(markup).toContain('aria-label="Quests" class="player-hud__quests"');
    expect(markup).toContain('aria-label="Messages" class="player-hud__quests player-hud__inbox"');
    // Level 2 grants 2 talent points, none placed yet: the talents button carries a badge.
    expect(markup).toContain('aria-label="Talents: 2 points to place" class="player-hud__quests player-hud__talents"');
    expect(markup).not.toContain("blessing");
    expect(renderWithI18n(createElement(PlayerHud, {
      store: storeWith({}), onOpenMessages: noop, onOpenQuests: noop, onOpenShop: noop, onOpenTalents: noop
    }))).toBe("");
  });
});

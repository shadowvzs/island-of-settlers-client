import { starterStockForNation } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  applyMapRules, dropForbiddenRules, startSetupEntries, startSetupFromEntries, toMapRulesState, withCatchUpToggled,
  withFeatureToggled, withFixedLevel, withFlagToggled
} from "../src/app/map-editor/map-rules/helpers";
import { createMapRulesControls } from "../src/app/map-editor/map-rules/map-rules-controls";
import { mapRulesView, mapRulesWarnings } from "../src/app/map-editor/map-rules/view-model";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";

describe("start setup lines", () => {
  it("shows the nation default and keeps it empty when the author does not change the wares", () => {
    const state = toMapRulesState({ ...createMapScenario(), nation: "indigenous", settlers: 7,
      startTroops: [{ count: 2, rank: 1, type: "archer" }] });
    const entries = startSetupEntries(state);
    expect(entries).toContainEqual({ amount: 48, kind: "ware", ware: "cloth" });
    expect(entries).toContainEqual({ amount: 7, kind: "settlers" });
    expect(entries).toContainEqual({ amount: 2, kind: "soldier", rank: 1, soldierType: "archer" });
    expect(startSetupFromEntries(entries, "indigenous"))
      .toEqual({ settlers: 7, startTroops: [{ count: 2, rank: 1, type: "archer" }], stock: {} });
  });

  it("writes changed wares as authored stock, clamped, and drops settlers and soldiers removed from the list", () => {
    const changed = [{ amount: 2_000_000, kind: "ware" as const, ware: "planks" },
      { amount: 250, kind: "soldier" as const, soldierType: "shield" as const }];
    expect(startSetupFromEntries(changed, "roman"))
      .toEqual({ settlers: 0, startTroops: [{ count: 200, rank: 0, type: "shield" }], stock: { planks: 100_000 } });
    const romanDefault = Object.entries(starterStockForNation("roman"))
      .map(([ware, amount]) => ({ amount, kind: "ware" as const, ware }));
    expect(startSetupFromEntries(romanDefault, "roman").stock).toEqual({});
  });
});

describe("map rule edits", () => {
  it("toggles narrowing switches and removes empty parts", () => {
    const scenario: MapScenario = createMapScenario();
    const rules = withFlagToggled(withFeatureToggled({}, "trade"), "talents");
    expect(rules).toEqual({ features: { trade: "off" }, talents: "none" });
    applyMapRules(scenario, withFlagToggled(withFeatureToggled(rules, "trade"), "talents"));
    expect("rules" in scenario).toBe(false);
    expect(withCatchUpToggled(withCatchUpToggled({}))).toEqual({});
    expect(withFixedLevel({}, "999").level?.level).toBeLessThan(999);
    expect(withFixedLevel({ level: { kind: "fixed", level: 3 } }, "")).toEqual({});
  });

  it("drops what a new map kind forbids", () => {
    const scenario: MapScenario = { ...createMapScenario(), kind: "home", startSetup: "off",
      rules: { level: { kind: "fixed", level: 3 }, offlineCatchUp: "skip", talents: "none" } };
    dropForbiddenRules(scenario);
    expect(scenario.rules).toEqual({ talents: "none" });
    expect("startSetup" in scenario).toBe(false);
  });

  it("edits through one undoable scenario edit and republishes the copy", () => {
    let scenario: MapScenario | undefined;
    const controls = createMapRulesControls({
      edit: change => { scenario ??= createMapScenario(); change(scenario); controls.refresh(); },
      scenario: () => scenario
    });
    controls.toggleFeature("colonies");
    controls.setFixedLevel("4");
    expect(scenario?.rules).toEqual({ features: { colonies: "off" } });
    controls.toggleStartSetup();
    expect(scenario?.startSetup).toBeUndefined();
    expect(controls.state.getSnapshot().rules).toEqual({ features: { colonies: "off" } });
  });
});

describe("mode-aware view", () => {
  it("warns by game mode and greys kind-forbidden options with the reason", () => {
    const adventure = toMapRulesState({ ...createMapScenario(), kind: "adventure", rewardCoins: 0 });
    expect(mapRulesWarnings(adventure, DEFAULT_ONLINE_SETTINGS)).toHaveLength(1);
    expect(mapRulesWarnings(adventure, GAME_SETTINGS_PRESETS.story)).toHaveLength(0);
    const campaign = toMapRulesState({ ...createMapScenario(), kind: "campaign", settlers: 0 });
    expect(mapRulesWarnings(campaign, GAME_SETTINGS_PRESETS.story)).toHaveLength(1);
    const home = mapRulesView(undefined, toMapRulesState(createMapScenario()), DEFAULT_ONLINE_SETTINGS);
    expect(home.level.disabled).toBe(true);
    expect(home.progression.find(toggle => toggle.id === "catchUp")).toMatchObject(
      { disabled: true, label: "Home maps always catch up" });
    expect(home.start.toggle).toBeNull();
    expect(home.mode.mode).toBe("Home island mode");
  });
});

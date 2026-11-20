import { describe, expect, it } from "vitest";

import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  editorGameSettings, editorSettingsStatus, publishEditorGameSettings
} from "../src/app/map-editor/map-rules/editor-game-settings";
import { editorModeView } from "../src/app/map-editor/map-rules/editor-mode";
import { toMapRulesState } from "../src/app/map-editor/map-rules/helpers";
import { createMapRulesControls } from "../src/app/map-editor/map-rules/map-rules-controls";
import {
  featureGameBlock, mapRewardsShown, mapRulesView, mapRulesWarnings
} from "../src/app/map-editor/map-rules/view-model";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";

const STORY = GAME_SETTINGS_PRESETS.story;
const changed = (base: GameSettings, change: (settings: GameSettings) => void) => {
  const next = cloneGameSettings(base);
  change(next);
  return next;
};
const stateOf = (change: Partial<MapScenario> = {}) => toMapRulesState({ ...createMapScenario(), ...change });
const toggleOf = (view: ReturnType<typeof mapRulesView>, id: string) =>
  [...view.features, ...view.progression].find(toggle => toggle.id === id)!;

describe("expedition toggles (owner Q7)", () => {
  it("offers settlement and exploring expeditions as separate toggles", () => {
    const view = mapRulesView(undefined, stateOf({ kind: "adventure" }), DEFAULT_ONLINE_SETTINGS);
    expect(view.features.map(toggle => toggle.id))
      .toEqual(["trade", "colonies", "adventures", "settlementExpeditions", "explorationExpeditions"]);
    expect(toggleOf(view, "explorationExpeditions")).toMatchObject({ disabled: false, pressed: false,
      label: "Exploring expeditions: allowed (click to switch off here)" });
    expect(toggleOf(view, "settlementExpeditions").label).toContain("Settlement expeditions");
    expect(toggleOf(view, "explorationExpeditions").icon).not.toBe(toggleOf(view, "settlementExpeditions").icon);
  });

  it("switches each expedition kind off on its own, as one undoable edit", () => {
    let scenario: MapScenario = { ...createMapScenario(), kind: "adventure" };
    const controls = createMapRulesControls({
      edit: change => { const next = structuredClone(scenario); if (change(next) !== false) scenario = next; },
      scenario: () => scenario
    });
    controls.toggleFeature("explorationExpeditions");
    expect(scenario.rules).toEqual({ features: { explorationExpeditions: "off" } });
    controls.toggleFeature("settlementExpeditions");
    controls.toggleFeature("explorationExpeditions");
    expect(scenario.rules).toEqual({ features: { settlementExpeditions: "off" } });
  });

  it("greys exploring expeditions while fog of war is off and keeps the map's own value", () => {
    const noFog = changed(DEFAULT_ONLINE_SETTINGS, settings => { settings.fogOfWar = false; });
    expect(featureGameBlock(noFog, "explorationExpeditions")).toBe("noFog");
    expect(featureGameBlock(noFog, "settlementExpeditions")).toBeUndefined();
    const view = mapRulesView(undefined, stateOf(), noFog);
    expect(toggleOf(view, "explorationExpeditions")).toMatchObject({ disabled: true, pressed: true,
      label: "Exploring expeditions: not applicable while fog of war is off" });
    expect(view.gameBadges).toEqual(["Exploring expeditions: not applicable while fog of war is off"]);
  });
});

describe("game-settings badges", () => {
  it("names what the game settings switch off beside the inherited rules", () => {
    const settings = changed(DEFAULT_ONLINE_SETTINGS, next => {
      next.features.trade = false;
      next.features.explorationExpeditions = false;
      next.progression.talents = false;
    });
    const view = mapRulesView(undefined, stateOf(), settings);
    expect(view.gameBadges).toEqual(["Off in the game settings: Trade office, Exploring expeditions, Talents"]);
    expect(toggleOf(view, "talents")).toMatchObject({ disabled: true, pressed: true,
      label: "Talents: off in the game settings" });
    expect(toggleOf(view, "experience")).toMatchObject({ disabled: false, pressed: false });
    expect(mapRulesView(undefined, stateOf(), DEFAULT_ONLINE_SETTINGS).gameBadges).toEqual([]);
  });

  it("explains that home features need a home island, and that the Story preset earns no XP or talents", () => {
    const view = mapRulesView(undefined, stateOf({ kind: "campaign" }), STORY);
    expect(view.features.every(toggle => toggle.disabled && toggle.gameBlock === "needsHome")).toBe(true);
    expect(view.gameBadges).toEqual([
      "Off in the game settings: Talents, Experience", "Trade, colonies, adventures and expeditions need a home island"
    ]);
  });
});

describe("rewards and start setup by mode (owner Q2)", () => {
  it("shows the map reward fields only when the game pays rewards home", () => {
    expect(mapRewardsShown("adventure", DEFAULT_ONLINE_SETTINGS)).toBe(true);
    expect(mapRewardsShown("home", DEFAULT_ONLINE_SETTINGS)).toBe(false);
    expect(mapRewardsShown("adventure", STORY)).toBe(false);
    const homeNoRewards = changed(DEFAULT_ONLINE_SETTINGS, next => { next.progression.rewards = false; });
    expect(mapRewardsShown("adventure", homeNoRewards)).toBe(false);
    // Wallet-only rewards (no home, rewards on) pay gems and XP: map reward coins stay hidden.
    expect(mapRewardsShown("adventure", changed(STORY, next => { next.progression.rewards = true; }))).toBe(false);
    const unpaid = stateOf({ kind: "adventure", rewardCoins: 0 });
    expect(mapRulesWarnings(unpaid, homeNoRewards)).toEqual([]);
    expect(mapRulesWarnings(unpaid, DEFAULT_ONLINE_SETTINGS)).toHaveLength(1);
  });

  it("notes an unused campaign start setup with a home and warns about a missing one without", () => {
    const campaign = stateOf({ kind: "campaign", settlers: 0 });
    const home = mapRulesView(undefined, campaign, DEFAULT_ONLINE_SETTINGS);
    expect(home.start.expeditionNote).toContain("Used only without a home island");
    expect(home.warnings).toEqual([]);
    const story = mapRulesView(undefined, campaign, STORY);
    expect(story.start.expeditionNote).toBe("");
    expect(story.warnings).toEqual(["No settlers or soldiers: without a home island this map could not be played."]);
    expect(mapRulesView(undefined, stateOf({ kind: "adventure" }), DEFAULT_ONLINE_SETTINGS).start.expeditionNote)
      .toBe("");
  });
});

describe("settings source of the editors (plan §13.4)", () => {
  it("shows the default mode as not loaded until the settings source answers", () => {
    expect(editorSettingsStatus.getSnapshot()).toBe("pending");
    expect(editorModeView(undefined, editorGameSettings.getSnapshot(), "pending")).toMatchObject(
      { mode: "Home island mode", notLoaded: "Mode not loaded", rewards: "Rewards on" });
    publishEditorGameSettings({ origin: "none", settings: null });
    expect(editorGameSettings.getSnapshot()).toBe(DEFAULT_ONLINE_SETTINGS);
    expect(editorModeView(undefined, DEFAULT_ONLINE_SETTINGS, editorSettingsStatus.getSnapshot()).notLoaded).toBe("");
    publishEditorGameSettings({ origin: "server", revision: "r7", settings: STORY });
    const view = editorModeView(undefined, editorGameSettings.getSnapshot(), editorSettingsStatus.getSnapshot());
    expect(view).toMatchObject({ mode: "No home island mode", notLoaded: "", rewards: "Rewards off",
      source: "The game mode comes from the server's game settings." });
    expect(editorModeView(undefined, changed(STORY, next => { next.progression.rewards = true; }), "bundled").rewards)
      .toBe("Gems and XP rewards only");
    publishEditorGameSettings({ origin: "none", settings: null });
    editorGameSettings.set(DEFAULT_ONLINE_SETTINGS);
  });
});

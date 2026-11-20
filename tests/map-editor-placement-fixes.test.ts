import { beforeAll, describe, expect, it } from "vitest";

import { createDecorationEditor, toDecorationModes } from "../src/app/map-editor/decoration-editor";
import { createEditorHistory } from "../src/app/map-editor/editor-history";
import type { EditRefresher } from "../src/app/map-editor/editor-refresh";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import { getMaterialRefusal, setAuthoredDeposits } from "../src/app/map-editor/marble-deposit-helpers";
import { createMarbleEditor } from "../src/app/map-editor/marble-editor";
import { resolveEditorText } from "../src/app/map-editor/messages";
import { TREE_AGE_OPTIONS } from "../src/app/map-editor/panel/palette-helpers";
import { createScenarioEditor } from "../src/app/map-editor/scenario-editor";
import {
  areEnemiesBlocked, ENEMIES_NEED_SCENARIO_HINT, HOME_KIND_BLOCKED_HINT
} from "../src/app/map-editor/scenario-enemy-policy";
import {
  getScenarioBuildingMarkerSource, getScenarioUnitMarkerSource
} from "../src/app/map-editor/scenario-overlay";
import { toScenarioSelectionView } from "../src/app/map-editor/scenario-selection-controls";
import { getGrowthState } from "../src/render-common/growth/tree-growth";
import { TREE_GROWTH_SECONDS } from "../src/shared/balance/economy";
import { getPlacementArchetypes, placeProp } from "../src/shared/world/editing/prop-placement";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { getAuthoredDeposits } from "../src/shared/world/marble-deposit";
import { BIRCH, getFormArchetype, HARDWOOD, PALM } from "../src/shared/world/tree-forms";
import { PROP, type WorldData } from "../src/shared/world/world-data";
import { findOpenSpots, SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";
import { createTestI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const i18n = createTestI18n();
const text = (value: Parameters<typeof resolveEditorText>[1]) => resolveEditorText(i18n, value);

const createHistory = (world: WorldData) => createEditorHistory({
  animals: { list: () => [], place: () => true, remove: noop },
  flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world
});

/** A fresh small island and its open building spots (the editors mutate the world). */
const createIsland = () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  return { spots: findOpenSpots(world, 2, 8), world };
};

describe("EDITOR-BUG-01 stone material deposits on any map", () => {
  beforeAll(() => { cachedWorld(SMALL_EDITOR_WORLD); }, 60_000);

  it("places a deposit on a plain home map without creating a scenario, with undo", () => {
    const { spots, world } = createIsland();
    const store = createEditorStore();
    const history = createHistory(world);
    const marble = createMarbleEditor(world, store, history, noop);
    marble.pick("limestone");
    expect(store.getState().tool).toEqual({ kind: "marble", value: 1 });
    expect(text(store.getState().hint)).toBe("Click clear dry ground to place the selected deposit.");
    marble.stamp(spots[0]!);
    expect(store.getState().hintIsRefusal).toBe(false);
    expect(text(store.getState().hint)).toMatch(/^Placed limestone \(48\); worked out, it vanishes and grows back here/);
    expect(world.scenario).toBeUndefined();
    expect(world.colonyStoneDeposits).toMatchObject([{ id: 0, material: "limestone" }]);
    expect(marble.section.get().options.map(option => text(option.label))).toEqual(["limestone 1: 48"]);
    history.undo();
    expect(world.colonyStoneDeposits ?? []).toEqual([]);
  });

  it("writes where the settlement reads: the scenario's own list, else the map's sources", () => {
    const { world } = createIsland();
    const deposit = { id: 0, remaining: 5, x: 10.5, z: 10.5 };
    setAuthoredDeposits(world, [deposit]);
    world.scenario = createMapScenario();
    expect(getAuthoredDeposits(world)).toEqual([deposit]);
    world.scenario = { ...createMapScenario(), marbleDeposits: [] };
    setAuthoredDeposits(world, [deposit]);
    expect(world.scenario.marbleDeposits).toEqual([deposit]);
  });

  it("keeps a colony map to its tier's stone", () => {
    const { world } = createIsland();
    world.colonyResourceTier = 1;
    expect(getMaterialRefusal(world, "marble")).toBeNull();
    expect(text(getMaterialRefusal(world, "granite"))).toBe("This colony's stone sources are marble.");
  });
});

describe("EDITOR-BUG-01 enemies, empty lists and tree ages", () => {
  it("keeps a home peaceful and places enemies only after switching to an adventure", () => {
    const { spots, world } = createIsland();
    const store = createEditorStore();
    const scenario = createScenarioEditor(world, store, createHistory(world), noop, noop);
    expect(areEnemiesBlocked(undefined)).toBe(true);
    expect(areEnemiesBlocked({ kind: "colony" })).toBe(false);
    expect(scenario.unitsSection.get().enemiesBlocked).toBe(true);

    scenario.activate("unit", "units");
    scenario.stamp(spots[0]!);
    expect(world.scenario).toBeUndefined();
    expect(store.getState().hint).toBe(ENEMIES_NEED_SCENARIO_HINT);
    scenario.activate("building", "units");
    scenario.stamp(spots[0]!);
    expect(world.scenario).toBeUndefined();

    scenario.setKind("adventure");
    expect(scenario.unitsSection.get().enemiesBlocked).toBe(false);
    scenario.activate("unit", "units");
    scenario.stamp(spots[0]!);
    const unit = world.scenario!.units[0]!;
    expect(unit).toMatchObject({ faction: 1, group: 0, rank: 0, type: "shield" });
    expect(scenario.unitsSection.get().selected).toBe(`unit:${unit.id}`);

    scenario.activate("building", "units");
    scenario.stamp(spots[1]!);
    expect(world.scenario!.buildings[0]).toMatchObject({ faction: 1, type: 1 });

    scenario.setKind("home");
    expect(world.scenario!.kind).toBe("adventure");
    expect(store.getState().hint).toBe(HOME_KIND_BLOCKED_HINT);
    expect(store.getState().tool).toBeNull();
    expect(scenario.unitsSection.get().enemiesBlocked).toBe(false);
  });

  it("gives new units and camps fresh ids, never the id of a deleted highest object (ACT1)", () => {
    const { spots, world } = createIsland();
    const scenario = createScenarioEditor(world, createEditorStore(), createHistory(world), noop, noop);
    scenario.setKind("adventure");
    scenario.activate("unit", "units");
    scenario.stamp(spots[0]!);
    scenario.activate("building", "units");
    scenario.stamp(spots[1]!);
    const camp = world.scenario!.buildings[0]!;
    expect(camp.id).toBe(world.scenario!.units[0]!.id + 1);
    scenario.remove("units");
    expect(world.scenario!.buildings).toEqual([]);
    scenario.stamp(spots[1]!);
    expect(world.scenario!.buildings[0]!.id).toBe(camp.id + 1);
  });

  it("starts an already enemy-capable map unlocked", () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    world.scenario = {
      ...createMapScenario(), kind: "adventure",
      units: [{ faction: 1, group: 0, heading: 0, id: 1, rank: 0, type: "shield", x: 10.5, z: 10.5 }]
    };
    const scenario = createScenarioEditor(world, createEditorStore(), createHistory(world), noop, noop);
    expect(scenario.unitsSection.get().enemiesBlocked).toBe(false);
  });

  it("leaves enemy placement when a draft becomes a peaceful home", () => {
    const { world } = createIsland();
    const store = createEditorStore();
    const scenario = createScenarioEditor(world, store, createHistory(world), noop, noop);
    scenario.setKind("adventure");
    scenario.activate("unit", "units");
    expect(store.getState().tool).toMatchObject({ kind: "scenario" });
    scenario.setKind("home");
    expect(world.scenario!.kind).toBe("home");
    expect(store.getState().tool).toBeNull();
    expect(scenario.unitsSection.get().enemiesBlocked).toBe(true);
  });

  it("previews the spawned soldier and themed camp models instead of flat marker symbols", () => {
    const scenario = {
      ...createMapScenario(), kind: "adventure" as const, nation: "viking" as const, theme: "desert" as const
    };
    const soldier = getScenarioUnitMarkerSource(scenario, { type: "archer" });
    expect(soldier).toContain("viking-archer");
    expect(soldier).not.toContain("army-");
    expect(getScenarioBuildingMarkerSource(scenario, { bandit: { code: 0, layout: 1 }, type: 2 }))
      .toContain("camp-desert-0-1");
    expect(getScenarioBuildingMarkerSource(scenario, {
      bandit: { code: 1, layout: 0 }, enclosure: "building" as const, type: 4
    })).toContain("outpost-desert-1-0");
    expect(getScenarioBuildingMarkerSource(scenario, { type: 1 })).toContain("viking-1");
  });

  it("hides an object list without objects (no placeholder-only select)", () => {
    expect(toScenarioSelectionView([], "", "units").options).toEqual([]);
    const view = toScenarioSelectionView([["unit:1", "shield 1", { x: 1, z: 1 }]], "", "units");
    expect(view.options.map(option => text(option.label))).toEqual(["Select unit or camp", "shield 1"]);
  });

  it("names every initial tree age after the growth stage it starts", () => {
    expect(TREE_AGE_OPTIONS.map(option => text(option.label))).toEqual([
      "Sprout (0s)", "Sapling (30s)", "Young (60s)", "Established (90s)", "Mature (120s)"
    ]);
    const stages = TREE_AGE_OPTIONS.map(option => getGrowthState(Number(option.value))?.stage ?? "mature");
    expect(stages).toEqual([1, 2, 3, 4, "mature"]);
  });
});

describe("EDITOR-BUG-01 a mature tree's random look", () => {
  const YOUNG_LOOKING = [[PROP.birchTree, BIRCH.young], [PROP.hardwoodTree, HARDWOOD.birchYoung],
    [PROP.palmTree, PALM.pygmyDate], [PROP.palmTree, PALM.ground]] as const;

  it("skips young-looking forms only when the tree starts mature", () => {
    for (const [kind, form] of YOUNG_LOOKING) {
      expect(getPlacementArchetypes(kind, TREE_GROWTH_SECONDS)).not.toContain(form);
      expect(getPlacementArchetypes(kind, TREE_GROWTH_SECONDS / 2)).toContain(form);
      expect(getPlacementArchetypes(kind)).toContain(form);
    }
    expect(getPlacementArchetypes(PROP.coniferTree, TREE_GROWTH_SECONDS))
      .toEqual(getPlacementArchetypes(PROP.coniferTree));
  });

  it("never places a mature birch, hardwood or palm with a young-looking form", () => {
    const { spots, world } = createIsland();
    const young = new Map<number, Set<number>>();
    for (const [kind, form] of YOUNG_LOOKING) young.set(kind, (young.get(kind) ?? new Set()).add(form));
    for (let seed = 0; seed < 40; seed++) {
      for (const kind of young.keys()) {
        const id = placeProp(world, { ageSeconds: TREE_GROWTH_SECONDS, kind, seed, ...spots[0]! });
        expect(typeof id).toBe("number");
        expect(young.get(kind)!.has(getFormArchetype(world.props.form[id as number]!))).toBe(false);
        removePropsAt(world, [id as number]);
      }
    }
  });
});

describe("EDITOR-UI-01 decoration selection highlight", () => {
  it("rings the selected decoration only while the select or move tool is active", () => {
    const { spots, world } = createIsland();
    const store = createEditorStore();
    const refresher = { finishStroke: noop, queue: noop } as unknown as EditRefresher;
    const decorations = createDecorationEditor(world, store, createHistory(world), refresher, () => 1, noop);
    expect(decorations.placeAt(spots[1]!, { propKind: PROP.smallRock, rotation: 0, scale: 1 })).toBe(true);
    expect(world.props.types[world.props.count - 1]).toBe(PROP.smallRock);
    expect(decorations.getHighlight()).toBeNull();
    decorations.selectOnMap();
    expect(decorations.section.get()).toMatchObject({ moveActive: false, selectActive: true });
    expect(decorations.getHighlight()).toMatchObject({ refused: false, x: spots[1]!.x, z: spots[1]!.z });
    store.clearTool();
    expect(decorations.getHighlight()).toBeNull();
    expect(toDecorationModes({ kind: "decoration", value: 2 })).toEqual({ moveActive: true, selectActive: false });
  });
});

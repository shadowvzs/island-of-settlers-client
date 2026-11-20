import { expect, it, vi } from "vitest";

import { createScenarioRenderPreview } from "../src/app/map-editor/scenario-render-preview";
import { createMapScenario, isMapScenario } from "../src/shared/world/map-scenario";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

/** The editor side of the preview: visibility and (here) no authored decoration models. */
const editor = (enabled: () => boolean) => ({ decorationFrames: () => [], decorationGhost: () => null,
  isEnabled: enabled });

const fixture = () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  world.scenario = { ...createMapScenario(), kind: "adventure", nation: "japanese", theme: "winter",
    headquarters: { x: 8, z: 8, rotation: 2 }, harbourPlot: { x: 14, z: 14, rotation: 1 },
    roads: [{ start: { x: 8, z: 12 }, end: { x: 8.5, z: 12 }, tier: "stone" }],
    marbleDeposits: [{ id: 0, x: 18, z: 18, remaining: 12 }],
    buildings: [{ id: 1, type: 4, bandit: { code: 1, layout: 1 }, enclosure: "building", x: 24.5, z: 12.5,
      faction: 3, defenders: 0, rotation: 1 },
    { id: 2, type: 16, x: 28.5, z: 16.5, faction: 2, defenders: 2, rotation: 3,
      catapult: { variant: "pirate", stones: 4, roofStones: 1 } }],
    units: [{ id: 3, type: "archer", rank: 2, x: 21, z: 13, heading: .7, faction: 4, group: 1 }] };
  return world;
};

it("feeds canonical real-model frames for all authored kinds without mutation or random side effects", () => {
  const world = fixture(), before = JSON.stringify(world);
  expect(isMapScenario(world.scenario, world.cellsX, world.cellsZ)).toBe(true);
  const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("global randomness"); });
  try {
    const preview = createScenarioRenderPreview(world, editor(() => true)), frame = preview.update();
    expect(frame.buildings).toHaveLength(3);
    expect(frame.buildings[0]).toMatchObject({ id: "editor-scenario-building-0", type: 0,
      nation: "japanese", owner: 0, rotation: Math.PI, construction: 1 });
    expect(frame.buildings[1]).toMatchObject({ type: 4, owner: 3, bandit: { code: 1, layout: 1 },
      enemyCampEnclosure: "building", enemyStyle: { theme: "winter" }, rotation: Math.PI / 2 });
    expect(frame.buildings[2]).toMatchObject({ type: 16, enemyCatapultVariant: "pirate",
      inputStock: { stone: 1 }, catapultSupply: { ground: 3 }, rotation: 3 * Math.PI / 2 });
    expect(frame.workers).toHaveLength(1);
    expect(frame.workers[0]).toMatchObject({ actorId: 3, x: 21, z: 13, heading: .7,
      armourRank: "centurion", combat: { type: "archer", faction: 4, attackProgress: null } });
    expect(frame.roads).toEqual(world.scenario!.roads);
    expect(frame.roads).not.toBe(world.scenario!.roads);
    expect(frame.marbleDeposits).toEqual(world.scenario!.marbleDeposits);
    expect(frame.placementGhost).toMatchObject({ type: 39, x: 14, z: 14, rotation: Math.PI / 2, nation: "japanese" });
    for (let count = 0; count < 100; count++) expect(preview.update()).toBe(frame);
    expect(JSON.stringify(world)).toBe(before);
  } finally { random.mockRestore(); }
});

it("invalidates placement, Apply, remove, undo/load, theme and nation without ghost objects or implicit HQ", () => {
  const world = fixture(), preview = createScenarioRenderPreview(world, editor(() => true));
  const original = preview.update();
  world.scenario!.buildings[0]!.rotation = 3; world.buildRevision = (world.buildRevision ?? 0) + 1;
  expect(preview.update().buildings[1]!.rotation).toBe(3 * Math.PI / 2);
  world.scenario!.theme = "desert";
  expect(preview.update().buildings[1]!.enemyStyle!.theme).toBe("desert");
  world.scenario!.nation = "persian";
  expect(preview.update().buildings[0]!.nation).toBe("persian");
  world.scenario = { ...world.scenario!, buildings: [], units: [], roads: [], marbleDeposits: [] };
  delete world.scenario.headquarters; delete world.scenario.harbourPlot;
  const removed = preview.update();
  expect(removed.buildings).toEqual([]); expect(removed.workers).toEqual([]);
  expect(removed.roads).toEqual([]); expect(removed.marbleDeposits).toEqual([]); expect(removed.placementGhost).toBeNull();
  world.scenario = structuredClone(fixture().scenario);
  expect(preview.update().buildings).toEqual(original.buildings);
});

it("clears owned preview frames on editor exit/dispose and rebuilds when reopened", () => {
  const world = fixture(); let active = true;
  const preview = createScenarioRenderPreview(world, editor(() => active)), first = preview.update();
  active = false;
  expect(preview.update()).toMatchObject({ buildings: [], workers: [], roads: [], placementGhost: null });
  active = true;
  expect(preview.update()).not.toBe(first); expect(preview.update().buildings).toHaveLength(3);
  preview.dispose(); world.scenario = undefined;
  expect(preview.update().buildings).toEqual([]);
});

it("renders ordinary home deposits without a scenario and uses canonical scenario fallback and removal", () => {
  const world = fixture(); world.scenario = undefined;
  world.colonyStoneDeposits = [{ id: 2, x: 15, z: 16, remaining: 8, material: "granite" }];
  const before = JSON.stringify(world), preview = createScenarioRenderPreview(world, editor(() => true));
  const frame = preview.update();
  expect(frame.buildings).toEqual([]); expect(frame.marbleDeposits).toEqual(world.colonyStoneDeposits);
  expect(preview.update()).toBe(frame); expect(JSON.stringify(world)).toBe(before);
  world.scenario = createMapScenario();
  expect(preview.update().marbleDeposits).toEqual(world.colonyStoneDeposits);
  world.scenario.marbleDeposits = [];
  expect(preview.update().marbleDeposits).toEqual([]);
  delete world.scenario.marbleDeposits;
  expect(preview.update().marbleDeposits).toEqual(world.colonyStoneDeposits);
  world.scenario = undefined; world.colonyStoneDeposits = [];
  expect(preview.update().marbleDeposits).toEqual([]);
});

import { describe, expect, it } from "vitest";

import { applyEditorTool } from "../src/app/map-editor/editor-apply";
import { TREE_CHOICES } from "../src/app/map-editor/editor-catalog";
import { createFellingSimulation } from "../src/render-common/felling/felling-simulation";
import { createTreeGrowth } from "../src/render-common/growth/tree-growth";
import { TREE_GROWTH_SECONDS } from "../src/shared/balance/economy";
import { createEditGround } from "../src/shared/world/editing/build-refresh";
import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { getPlacementArchetypes } from "../src/shared/world/editing/prop-placement";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import { applyStampChanges, refreshEditedTerrain } from "../src/shared/world/editing/terrain/terrain-apply";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const paletteWorld = () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  world.props.count = 0; world.heights.fill(3); world.waterSurface.fill(0); world.waterDepth.fill(0);
  world.flow.fill(0); world.mineZone.fill(0); world.oreAmount.fill(0); world.mineZones = [];
  world.generatedRivers = []; world.authoredRivers = [];
  refreshEditedTerrain(world, { minX: 0, minZ: 0, maxX: 95, maxZ: 95 }, true);
  return world;
};

describe("editor palette lifecycle integration", () => {
  it("preserves all selectable timber appearances/ages through sculpt, history, map save, growth and felling", async () => {
    const world = paletteWorld(), growth = createTreeGrowth([], 1, id => world.props.types[id] !== PROP_REMOVED);
    const ids: number[] = [];
    world.authoredTreeAges = {};
    for (const { value: kind } of TREE_CHOICES) {
      let count = 1;
      if (kind === PROP.hardwoodTree) count = 9;
      if (kind === PROP.mahoganyTree || kind === PROP.walnutTree) count = 4;
      for (let form = 0; form < count; form++) for (const age of [0, 30, 60, 90, 120]) {
        const index = ids.length, x = 8.5 + index % 25 * 3, z = 8.5 + Math.floor(index / 25) * 3;
        const result = applyEditorTool({ world, ground: createEditGround(world), firstPlacedProp: 0,
          nextSeed: () => index + 1, placeAnimal: () => false, treeAge: age, hardwoodForm: form },
        { kind: "tree", value: kind }, { x, z }, 1);
        expect(result.placed).toHaveLength(1);
        const id = result.placed[0]!;
        ids.push(id); growth.plant(id, world.authoredTreeAges![id]!);
      }
    }
    expect(ids).toHaveLength(115);
    const identities = ids.map(id => [world.props.types[id], world.props.form[id], world.props.phase[id],
      world.props.rotation[id], world.props.scale[id], world.props.x[id], world.props.z[id]]);
    const snapshot = createWorldSnapshot(world, null); snapshot.capture();
    const state = createTerrainEditState();
    for (const mode of ["raise", "lower", "smooth"] as const) {
      for (const id of ids) applyStampChanges(world, state, [], null, [{
        x: world.props.x[id]!, z: world.props.z[id]!, radius: 1.5, mode
      }]);
      for (const id of ids) expect(world.props.y[id]).toBeCloseTo(
        sampleSmooth(world, world.heights, world.props.x[id]!, world.props.z[id]!), 5);
    }
    applyStampChanges(world, state, [], null, [{ x: 8.5, z: 8.5, radius: 2, mode: "raise" }]);
    const diff = snapshot.diff(); expect(diff).not.toBeNull();
    if (!diff) throw new Error("Combined sculpt should produce history");
    const after = world.heights.slice();
    applyWorldDiff(world, null, diff, "before"); expect(world.heights.every(y => y === 3)).toBe(true);
    applyWorldDiff(world, null, diff, "after"); expect(world.heights).toEqual(after);
    expect(ids.map(id => [world.props.types[id], world.props.form[id], world.props.phase[id],
      world.props.rotation[id], world.props.scale[id], world.props.x[id], world.props.z[id]])).toEqual(identities);
    const saved = await readMapFile(await writeMapFile(world,
      { name: "Full timber palette", source: "acceptance", savedAt: 1, animals: [] }));
    expect(saved.world.authoredTreeAges).toEqual(world.authoredTreeAges);
    for (const key of ["types", "form", "phase", "rotation", "scale", "x", "y", "z"] as const)
      expect(saved.world.props[key].slice(0, ids.length)).toEqual(world.props[key].slice(0, ids.length));
    const resumed = createTreeGrowth([], 1, () => true); resumed.loadState(growth.saveState());
    resumed.update(TREE_GROWTH_SECONDS + 1);
    for (const id of ids) expect(resumed.frame.isGrown(id)).toBe(true);
    const removed: number[] = [];
    const felling = createFellingSimulation(id => ({ x: world.props.x[id]!, y: world.props.y[id]!,
      z: world.props.z[id]!, canopyHeight: 3, canopyRadius: 1 }), 1, id => removed.push(id));
    for (const id of ids) expect(felling.fell(id)).toBe(true);
    felling.update(3.5); for (const id of ids) expect(felling.frame.getState(id).phase).toBe("falling");
    felling.update(20); expect(removed.sort((a, b) => a - b)).toEqual(ids);
    felling.update(30); expect(removed).toHaveLength(ids.length); expect(felling.countStumps()).toBe(0);
  }, 30000);
  it("reaches every supported seeded structural form at young and mature ages using actual editor tools", () => {
    const world = paletteWorld();
    for (const { value: kind } of TREE_CHOICES.filter(tree => tree.value !== PROP.sapling)) {
      for (const age of [0, TREE_GROWTH_SECONDS]) {
        const expected = new Set(getPlacementArchetypes(kind, age) ?? [0]), seen = new Set<number>();
        for (let seed = 1; seed <= 512 && seen.size < expected.size; seed++) {
          const result = applyEditorTool({ world, ground: createEditGround(world), firstPlacedProp: 0,
            nextSeed: () => seed, placeAnimal: () => false, treeAge: age },
          { kind: "tree", value: kind }, { x: 20.5, z: 20.5 }, 1);
          expect(result.placed).toHaveLength(1);
          const id = result.placed[0]!;
          seen.add(world.props.form[id]! & 15);
          removePropsAt(world, [id]);
        }
        expect(seen).toEqual(expected);
      }
    }
  });

});

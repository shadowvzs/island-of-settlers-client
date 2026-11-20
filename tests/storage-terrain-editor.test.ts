import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorMutationGuard } from "../src/app/map-editor/editor-bootstrap";
import { createEditorHistory } from "../src/app/map-editor/editor-history";
import { createTerrainTool, type TerrainToolOptions } from "../src/app/map-editor/terrain-tool";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const noop = () => undefined;
const fixture = (canEdit: () => boolean) => {
  const world = structuredClone(cachedWorld(SMALL_EDITOR_WORLD));
  world.heights.fill(4); world.waterSurface.fill(0); world.waterDepth.fill(0); world.riverDistance.fill(100);
  const discarded = vi.fn(), rebased = vi.fn();
  const tool = createTerrainTool({
    builders: { keepEditWorkers: noop }, canEdit, onDiscarded: discarded, onTerrainEdited: rebased,
    world
  } as unknown as TerrainToolOptions);
  return { discarded, rebased, tool, world };
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("live storage terrain refusal", () => {
  it("refuses before stopping a recording, and keeps empty standalone editors editable", () => {
    const onEdit = vi.fn(), notify = vi.fn();
    const denied = createEditorMutationGuard({ canEditStorageTerrain: () => false, onEdit }, notify);
    expect(denied.onEdit()).toBe(false); expect(onEdit).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    expect(createEditorMutationGuard({ onEdit }, notify).onEdit()).toBe(true);
    expect(onEdit).toHaveBeenCalledOnce();
  });
  it("refuses every direct terrain mutation before stamp state or timers change", () => {
    vi.stubGlobal("window", globalThis);
    const { rebased, tool, world } = fixture(() => false);
    const heights = new Float32Array(world.heights), state = structuredClone(tool.state);
    tool.click({ x: 24, z: 24 }, false, 1, undefined);
    tool.ridge({ x: 20, z: 20 }, { x: 28, z: 28 }, 2, undefined);
    tool.editFeature(1, null); tool.brushAt({ x: 24, z: 24 }, 4, "sea");
    expect(tool.resetAt({ x: 24, z: 24 }, 4)).toBe(0);
    tool.flush();
    expect(tool.state).toEqual(state); expect(world.heights).toEqual(heights);
    expect(tool.isQueued()).toBe(false); expect(rebased).not.toHaveBeenCalled();
  });

  it("rechecks a queued edit and restores stamp IDs before any world/history/relocation mutation", () => {
    vi.useFakeTimers(); vi.stubGlobal("window", globalThis);
    let permitted = true;
    const { discarded, rebased, tool, world } = fixture(() => permitted);
    const state = structuredClone(tool.state), heights = new Float32Array(world.heights);
    tool.click({ x: 24, z: 24 }, false, 1, undefined);
    expect(tool.isQueued()).toBe(true); expect(tool.state.nextId).toBeGreaterThan(state.nextId);
    permitted = false; tool.flush();
    expect(tool.state).toEqual(state); expect(world.heights).toEqual(heights);
    expect(tool.stats.busy).toBe(false); expect(tool.isQueued()).toBe(false);
    expect(discarded).toHaveBeenCalledOnce(); expect(rebased).not.toHaveBeenCalled();
    vi.runAllTimers(); expect(discarded).toHaveBeenCalledOnce();
  });

  it("keeps refused undo/redo and their history positions intact, then rebases only restored terrain", () => {
    const world = structuredClone(cachedWorld(SMALL_EDITOR_WORLD)), terrain = createTerrainEditState();
    const vertex = 24 * (world.cellsX + 1) + 24, original = world.heights[vertex]!;
    let permitted = true;
    const restored: number[] = [], before = vi.fn();
    const history = createEditorHistory({
      animals: { list: () => [], place: () => true, remove: noop }, canRestore: () => permitted,
      beforeRestore: before, afterRestore: () => restored.push(world.heights[vertex]!), flush: noop,
      isQueued: () => false, rebuild: noop, terrain, world
    });
    history.begin(); world.heights[vertex] = original + 2;
    const changed = world.heights[vertex]!;
    history.note({ cells: { minX: 24, minZ: 24, maxX: 24, maxZ: 24 }, ground: true }); history.endStroke();
    permitted = false; history.undo();
    expect(world.heights[vertex]).toBeCloseTo(original + 2); expect(history.getState().canUndo).toBe(true);
    expect(before).not.toHaveBeenCalled(); expect(restored).toEqual([]);
    permitted = true; history.undo(); expect(world.heights[vertex]).toBeCloseTo(original);
    expect(restored).toEqual([original]);
    permitted = false; history.redo(); expect(history.getState().canRedo).toBe(true);
    expect(world.heights[vertex]).toBeCloseTo(original);
    permitted = true; history.redo(); expect(restored).toEqual([original, changed]);
  });
});

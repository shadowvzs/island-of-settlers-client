import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COAST_PREVIEW_DISCARDED, createCoastReshapeEditor, NO_COAST_PREVIEW
} from "../src/app/map-editor/coast-reshape-editor";
import type { EditorHistory } from "../src/app/map-editor/editor-history";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import type { TerrainTool } from "../src/app/map-editor/terrain-tool";
import type { TerrainRenderer } from "../src/render-common/renderer-contract";
import { refreshEditedTerrain } from "../src/shared/world/editing/terrain/terrain-apply";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";

const noop = () => {};

/** A straight 64 x 64 shore along x = 32 (as in coast-reshape.test) and the coast editor on it. */
const createShoreEditor = (onEdit: () => boolean | void = noop) => {
  const world = structuredClone(cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, forest: 0,
    mountains: 0, rivers: 0, erosionDroplets: 0, oreCapacity: false }));
  world.seaLevel = 0; world.props.count = 0; world.mineZone.fill(0); world.mineZones = [];
  world.colonyStoneDeposits = undefined; world.scenario = undefined;
  world.generatedRivers = undefined; world.authoredRivers = undefined;
  world.settlementGroundClearance = undefined; world.flow.fill(0);
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    world.heights[vertex] = Math.max(-3, Math.min(2, (vertex % 65 - 32) * .18));
    world.waterSurface[vertex] = 0; world.waterDepth[vertex] = Math.max(0, -world.heights[vertex]!);
  }
  refreshEditedTerrain(world, { minX: 0, minZ: 0, maxX: 63, maxZ: 63 }, true);
  const store = createEditorStore();
  const terrain = { state: createTerrainEditState(), stats: { busy: false } } as unknown as TerrainTool;
  const history = { subscribe: noop } as unknown as EditorHistory;
  const renderer = { pickGround: () => ({ x: 32, y: 0, z: 32 }) } as unknown as TerrainRenderer;
  const viewport = { append: noop, clientHeight: 600, clientWidth: 800 } as unknown as HTMLElement;
  const editor = createCoastReshapeEditor(world, viewport, renderer, terrain, history, store, onEdit, noop);
  return { editor, store, world };
};

describe("coast reshape preview cancel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { createElement: () => ({ setAttribute: noop, style: {} }) });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("refuses a valid preview commit before opening history or changing live terrain", () => {
    const { editor, world } = createShoreEditor(() => false);
    editor.preview(); vi.runAllTimers(); expect(editor.section.get().commitDisabled).toBe(false);
    const heights = new Float32Array(world.heights), water = new Float32Array(world.waterSurface);
    editor.commit();
    expect(world.heights).toEqual(heights); expect(world.waterSurface).toEqual(water);
    // History has no begin method in this fixture: reaching it would fail the refusal check.
  });

  it("confirms a discarded preview on the hint line and disables Apply", () => {
    const { editor, store } = createShoreEditor();
    editor.preview(); vi.runAllTimers();
    expect(editor.section.get().commitDisabled).toBe(false);
    editor.cancelPreview();
    expect(store.getState()).toMatchObject({ hint: COAST_PREVIEW_DISCARDED, hintIsRefusal: false });
    expect(editor.section.get()).toMatchObject({ commitDisabled: true, status: COAST_PREVIEW_DISCARDED });
  });

  it("confirms a preview cancelled while it is still being prepared, without a failure warning", () => {
    const { editor, store } = createShoreEditor();
    editor.preview(); editor.cancelPreview(); vi.runAllTimers();
    expect(store.getState()).toMatchObject({ hint: COAST_PREVIEW_DISCARDED, hintIsRefusal: false });
    expect(editor.section.get()).toMatchObject({ commitDisabled: true, previewing: false });
  });

  it("says when there is no preview to cancel", () => {
    const { editor, store } = createShoreEditor();
    editor.cancelPreview();
    expect(store.getState().hint).toBe(NO_COAST_PREVIEW);
  });
});

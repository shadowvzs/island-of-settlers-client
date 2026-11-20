import { describe, expect, it } from "vitest";

import { createEditorHistory } from "../src/app/map-editor/editor-history";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import { createRiverEditor, RIVER_DONE } from "../src/app/map-editor/river-editor";
import type { TerrainTool } from "../src/app/map-editor/terrain-tool";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const noop = () => {};

/** The river editor on a generated island that already has generated rivers. */
const createEditor = (onEdit: () => boolean | void = noop) => {
  const world = structuredClone(cachedWorld(SMALL_EDITOR_WORLD));
  const store = createEditorStore(), state = createTerrainEditState();
  const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
    flush: noop, isQueued: () => false, rebuild: noop, terrain: state, world });
  const terrain = { flush: noop, rebuildArea: noop, state, stats: { busy: false } } as unknown as TerrainTool;
  const editor = createRiverEditor(world, store, history, terrain, onEdit, noop, noop);
  return { editor, history, store, world };
};

const drawRiver = (editor: ReturnType<typeof createEditor>["editor"]) => {
  editor.drawRiver();
  [{ x: 24, z: 24 }, { x: 32, z: 35 }, { x: 40, z: 46 }].forEach((point, index) => editor.stamp(point, index === 0));
  editor.finish();
};

describe("river editor selection", () => {
  it("refuses a completed river drawing before terrain, river records or history change", () => {
    const { editor, history, world } = createEditor(() => false);
    const heights = new Float32Array(world.heights), rivers = structuredClone(world.authoredRivers);
    drawRiver(editor);
    expect(world.heights).toEqual(heights); expect(world.authoredRivers).toEqual(rivers);
    expect(history.stats().steps).toBe(0);
  });
  it("confirms finished river edits and shows the armed endpoint tool as pressed", () => {
    const { editor, store, world } = createEditor();
    drawRiver(editor);
    expect(store.getState().hint).toBe(RIVER_DONE.drawn);
    editor.moveMouth();
    expect(editor.section.get()).toMatchObject({ drawPressed: false, mouthPressed: true });
    editor.stamp({ x: 44, z: 50 }, true);
    expect(world.authoredRivers![0]!.points.at(-1)).toEqual({ x: 44, z: 50 });
    expect(store.getState().hint).toBe(RIVER_DONE.mouth);
    editor.moveMouth();
    expect(editor.section.get().mouthPressed).toBe(false);
  });

  it("keeps the drawn river selected through undo / redo, so Apply size and Remove act on it", () => {
    const { editor, history, world } = createEditor();
    const generatedScales = () => world.generatedRivers?.map(river => [river.id, river.widthScale]);
    const scales = generatedScales();
    expect(scales?.length).toBeGreaterThan(0);
    drawRiver(editor);
    expect(world.authoredRivers).toHaveLength(1);
    history.undo();
    expect(editor.section.get().selected).toBe("g:1");
    history.redo();
    expect(editor.section.get()).toMatchObject({ selected: "a:1", width: "2" });
    editor.section.update({ width: "4" });
    editor.applyDimensions();
    expect(world.authoredRivers![0]!.width).toBe(4);
    editor.removeSelected();
    expect(world.authoredRivers).toEqual([]);
    expect(generatedScales()).toEqual(scales);
  });
});

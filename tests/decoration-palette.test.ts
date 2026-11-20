import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  isEditorDecorationItem, ROAD_DECORATION_ITEM_DEFINITIONS, type RoadDecorationItemId
} from "../../island-of-settlers-shared/src/road-decoration-items";
import { createDecorationEditor } from "../src/app/map-editor/decoration-editor";
import { createDecorationPaletteEditor, PALETTE_MODE } from "../src/app/map-editor/decoration-palette-editor";
import { createEditorHistory } from "../src/app/map-editor/editor-history";
import type { EditRefresher } from "../src/app/map-editor/editor-refresh";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import {
  ALL_CATEGORIES, filterPaletteTiles, getPaletteCategoryTabs, getVariantOptions, toPaletteTile
} from "../src/app/map-editor/panel/decoration-palette-helpers";
import { roadDecorationModelReady } from "../src/render-common/road-decoration-readiness";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { DECORATION_KINDS } from "../src/shared/world/editing/decoration-editing";
import {
  findDecorationEntryForItem, isEditorPaletteItem, listDecorationCategories, listDecorationEntries, NATURAL_DECORATION_CATEGORY
} from "../src/shared/world/editing/decoration-registry";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { PROP } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";
import { createTestI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const english = createTestI18n();
const hungarian = createTestI18n("hu");
const ARCH = "roadDecoration:roman-rusticated-arch:limestone" as RoadDecorationItemId;

const paletteTiles = (i18n = english) => listDecorationEntries().map(entry => toPaletteTile(entry, i18n));
const placeableItems = () => (Object.keys(ROAD_DECORATION_ITEM_DEFINITIONS) as RoadDecorationItemId[])
  .filter(id => {
    if (!isEditorDecorationItem(ROAD_DECORATION_ITEM_DEFINITIONS[id]!)) return false;
    const definition = getRoadDecoration(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.decoration);
    return definition !== undefined && roadDecorationModelReady(definition);
  });

describe("decoration palette registry", () => {
  it("shows every registered decoration: every ground decoration kind and every placeable item", () => {
    const shown = new Set(filterPaletteTiles(paletteTiles(), ALL_CATEGORIES, "").map(tile => tile.id));
    const entries = listDecorationEntries();
    expect(shown.size).toBe(entries.length);
    for (const [, kind] of DECORATION_KINDS) expect(shown.has(`ground:${kind}`)).toBe(true);
    const items = placeableItems();
    expect(items.length).toBeGreaterThan(100);
    for (const item of items) {
      const entry = findDecorationEntryForItem(item);
      expect(entry, item).toBeDefined();
      expect(shown.has(entry!.id), item).toBe(true);
    }
    const listed = entries.flatMap(entry => (entry.source === "placed" ? entry.items : []));
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.length).toBe(items.length);
  });

  it("offers editor-placeable models regardless of shop availability, never building-only ones", () => {
    const base = ROAD_DECORATION_ITEM_DEFINITIONS["roadDecoration:japanese-wooden-lantern:native"]!;
    expect(isEditorPaletteItem({ ...base, shopAvailable: false, uses: ["building", "editor"] })).toBe(true);
    expect(isEditorPaletteItem({ ...base, shopAvailable: true, uses: ["building"] })).toBe(false);
    expect(isEditorPaletteItem({ ...base, uses: ["shop", "editor"] })).toBe(true);
  });

  it("gives each tile a real icon file and an English and Hungarian name", () => {
    const tiles = paletteTiles(), translated = paletteTiles(hungarian);
    for (const [index, tile] of tiles.entries()) {
      expect(tile.icon, tile.id).not.toBeNull();
      if (tile.icon!.src.startsWith("/icons/")) expect(existsSync(`public${tile.icon!.src}`), tile.id).toBe(true);
      expect(tile.label.length).toBeGreaterThan(1);
      expect(translated[index]!.label.length).toBeGreaterThan(1);
    }
    expect(translated.filter((tile, index) => tile.label !== tiles[index]!.label).length)
      .toBeGreaterThan(tiles.length / 2);
  });

  it("filters by category tab and by every search word, natural props first", () => {
    const categories = listDecorationCategories();
    expect(categories[0]).toBe(NATURAL_DECORATION_CATEGORY);
    expect(getPaletteCategoryTabs(ALL_CATEGORIES, english).map(tab => tab.id)).toEqual([ALL_CATEGORIES, ...categories]);
    const tiles = paletteTiles();
    for (const category of categories)
      expect(filterPaletteTiles(tiles, category, "").every(tile => tile.category === category)).toBe(true);
    expect(filterPaletteTiles(tiles, ALL_CATEGORIES, "ROMAN arch").map(tile => tile.label))
      .toContain("Roman rusticated arch");
    expect(filterPaletteTiles(tiles, ALL_CATEGORIES, "no-such-decoration")).toEqual([]);
  });

  it("offers finishes and structural variants of one model as variant choices", () => {
    expect(getVariantOptions(findDecorationEntryForItem(ARCH), english).map(option => option.label))
      .toEqual(["Limestone", "Granite", "Marble"]);
    const lavender = findDecorationEntryForItem("roadDecoration:plant-lavender-roadside-pot-1:native");
    expect(getVariantOptions(lavender, english).map(option => option.label))
      .toEqual(["Variant 1", "Variant 2", "Variant 3"]);
  });
});

describe("decoration palette editor", () => {
  const setup = () => {
    const world = huntingWorld(), store = createEditorStore();
    const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
      flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world });
    const refresher = { finishStroke: noop, queue: noop } as unknown as EditRefresher;
    const ground = createDecorationEditor(world, store, history, refresher, () => 1, noop);
    return { history, palette: createDecorationPaletteEditor(world, store, history, ground, noop), store, world };
  };

  it("places and removes decoration models in the scenario with undo and redo", () => {
    const { history, palette, store, world } = setup();
    palette.select(findDecorationEntryForItem(ARCH)!.id);
    expect(store.getState().tool).toEqual({ kind: "decorationPalette", value: PALETTE_MODE.place });
    palette.stamp({ x: 20, z: 20 });
    expect(store.getState().hintIsRefusal).toBe(true);
    world.scenario = createMapScenario();
    palette.section.update({ rotation: "90", variant: "roadDecoration:roman-rusticated-arch:marble" });
    palette.stamp({ x: 20, z: 20 });
    expect(world.scenario.decorations).toEqual([{ id: 1, item: "roadDecoration:roman-rusticated-arch:marble", x: 20,
      yaw: Math.PI / 2, z: 20 }]);
    expect(palette.frames()).toHaveLength(1);
    expect(palette.getGhost({ x: 20.2, z: 20 })).toMatchObject({ valid: false });
    expect(palette.getGhost({ x: 40, z: 40 })).toMatchObject({ valid: true });
    palette.startRemoving();
    palette.stamp({ x: 20.5, z: 20.5 });
    expect(world.scenario!.decorations).toEqual([]);
    expect(palette.getGhost({ x: 40, z: 40 })).toBeNull();
    history.undo();
    expect(world.scenario!.decorations).toHaveLength(1);
    history.redo();
    expect(world.scenario!.decorations).toEqual([]);
    // ACT1: the deleted model's id is never handed out again.
    palette.startPlacing();
    palette.stamp({ x: 20, z: 20 });
    expect(world.scenario!.decorations!.map(row => row.id)).toEqual([2]);
    expect(world.scenario!.nextObjectId).toBe(3);
  });

  it("places natural props as world props with rotation and clamped scale", () => {
    const { palette, world } = setup();
    palette.select(`ground:${PROP.fern}`);
    palette.section.update({ rotation: "180", scale: "9" });
    const count = world.props.count;
    palette.stamp({ x: 30.5, z: 30.5 });
    expect(world.props.count).toBe(count + 1);
    expect(world.props.types[count]).toBe(PROP.fern);
    expect(world.props.rotation[count]).toBeCloseTo(Math.PI);
    expect(world.props.scale[count]).toBe(1.5);
  });

  it("packs ground decorations down to half a tile, sharing cells only with decorations", () => {
    const { palette, store, world } = setup();
    palette.select(`ground:${PROP.bush}`);
    const count = world.props.count;
    palette.stamp({ x: 30.2, z: 30.2 });
    palette.stamp({ x: 30.75, z: 30.2 });
    expect(world.props.count).toBe(count + 2);
    palette.stamp({ x: 30.75, z: 30.5 });
    expect(world.props.count).toBe(count + 2);
    expect(store.getState().hintIsRefusal).toBe(true);
  });
});

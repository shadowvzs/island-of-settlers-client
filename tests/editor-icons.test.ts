import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ANIMAL_CHOICES,
  DOODAD_CHOICES,
  GROUND_CHOICES,
  HISTORY_ACTIONS,
  LOWER_TOGGLE,
  MAP_ACTIONS,
  ORE_CHOICES,
  PLANT_REMOVER,
  RELIEF_TOOLS,
  TERRAIN_TOOLS,
  TREE_CHOICES,
  TREE_REMOVER
} from "../src/app/map-editor/editor-catalog";

const ICONS = [
  ...RELIEF_TOOLS,
  ...TERRAIN_TOOLS,
  LOWER_TOGGLE,
  ...GROUND_CHOICES,
  ...ORE_CHOICES,
  ...DOODAD_CHOICES,
  PLANT_REMOVER,
  ...TREE_CHOICES,
  TREE_REMOVER,
  ...ANIMAL_CHOICES
].map(({ icon }) => icon);

/** Map actions share icons (save file / overwrite slot, load file / load slot). */
const MAP_ICONS = [...new Set(Object.values(MAP_ACTIONS).map(({ icon }) => icon))];
const HISTORY_ICONS = Object.values(HISTORY_ACTIONS).map(({ icon }) => icon);

describe("map editor icons", () => {
  it("names every tool's icon once", () => {
    expect(new Set(ICONS).size).toBe(ICONS.length);
    expect(ICONS).toContain("tree-oak");
    expect(ICONS).toContain("tile-mine-gravel");
  });

  it("has the 1x and 2x file of every icon (tools/assets/editor-icons.ts)", () => {
    for (const icon of [...ICONS, ...MAP_ICONS, ...HISTORY_ICONS]) {
      expect(existsSync(`assets/editor-icons/${icon}.webp`), icon).toBe(true);
      expect(existsSync(`assets/editor-icons/${icon}@2x.webp`), icon).toBe(true);
    }
  });
});

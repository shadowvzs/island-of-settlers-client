import { describe, expect, it } from "vitest";

import { createForestDepth } from "../src/render-common/wildlife/nav/forest-depth";
import { createColliderSet } from "../src/render-common/wildlife/nav/nav-colliders";
import {
  createPathFinder,
  MAX_PATH_POINTS
} from "../src/render-common/wildlife/nav/nav-path";
import {
  createPathWorkspace,
  PATH_PAGE_CELLS,
  PATH_PAGE_POOL
} from "../src/render-common/wildlife/nav/nav-path-workspace";
import { createNavTerrain } from "../src/render-common/wildlife/nav/nav-terrain";
import { createSpeciesNav } from "../src/render-common/wildlife/nav/species-nav";
import {
  SPECIES,
  SPECIES_IDS,
  SPECIES_PROFILES
} from "../src/render-common/wildlife/wildlife-species";
import { createRandom } from "../src/shared/world/rng";
import { createLegacyPathFinder } from "./helpers/legacy-nav-path";

const CELLS = 256;

const openNav = (cells: number) => {
  const terrain = createNavTerrain({
    cellsX: cells,
    cellsZ: cells,
    height: () => 1,
    isBlockedGround: () => false,
    waterDepth: () => 0
  });
  const colliders = createColliderSet(cells, cells, []);
  const forestDepth = createForestDepth(terrain, colliders);
  return {
    colliders,
    species: SPECIES_IDS.map((id) =>
      createSpeciesNav(terrain, colliders, SPECIES_PROFILES[id]!, id, forestDepth)
    ),
    terrain
  };
};

describe("paged wildlife path workspace", () => {
  it("matches the legacy finder on 2,000 seeded queries", { timeout: 30_000 }, () => {
    const nav = openNav(CELLS);
    const modern = createPathFinder(nav), legacy = createLegacyPathFinder(nav);
    const random = createRandom(9137);
    const modernOut = new Float32Array(MAX_PATH_POINTS * 2);
    const legacyOut = new Float32Array(MAX_PATH_POINTS * 2);
    for (let query = 0; query < 2_000; query += 1) {
      const startX = 1 + random() * (CELLS - 2);
      const startZ = 1 + random() * (CELLS - 2);
      const targetX = 1 + random() * (CELLS - 2);
      const targetZ = 1 + random() * (CELLS - 2);
      const modernCount = modern.findPath(SPECIES.deer, startX, startZ, targetX, targetZ, modernOut);
      const legacyCount = legacy.findPath(SPECIES.deer, startX, startZ, targetX, targetZ, legacyOut);
      expect(modernCount).toBe(legacyCount);
      expect(Array.from(modernOut.subarray(0, modernCount * 2)))
        .toEqual(Array.from(legacyOut.subarray(0, legacyCount * 2)));
    }
  });

  it("falls back beyond the page pool without losing written values", () => {
    const width = PATH_PAGE_CELLS * 9;
    const workspace = createPathWorkspace(width, width);
    workspace.begin();
    const pages = 9 * 9;
    for (let page = 0; page < pages; page += 1) {
      const x = (page % 9) * PATH_PAGE_CELLS + 1;
      const z = Math.floor(page / 9) * PATH_PAGE_CELLS + 1;
      const cell = z * width + x;
      workspace.markSeen(cell);
      workspace.setCost(cell, page);
      workspace.setParent(cell, page + 1);
      workspace.markDone(cell);
    }
    expect(pages).toBeGreaterThan(PATH_PAGE_POOL);
    for (let page = 0; page < pages; page += 1) {
      const x = (page % 9) * PATH_PAGE_CELLS + 1;
      const z = Math.floor(page / 9) * PATH_PAGE_CELLS + 1;
      const cell = z * width + x;
      expect(workspace.isSeen(cell)).toBe(true);
      expect(workspace.cost(cell)).toBe(page);
      expect(workspace.parent(cell)).toBe(page + 1);
      expect(workspace.isDone(cell)).toBe(true);
    }
    workspace.begin();
    expect(workspace.isSeen(1 * width + 1)).toBe(false);
  });
});

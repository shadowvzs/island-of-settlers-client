import { BUILD, type WorldData } from "../../shared/world/world-data";
import type { NavWorld } from "../wildlife/nav/nav-query";
import { NAV_RES } from "../wildlife/nav/nav-terrain";
import { labelRegions, type SpeciesNav } from "../wildlife/nav/species-nav";

/** The world layers the worker ground reads (cells). */
interface BuildGrid {
  buildClass: Uint8Array;
  cellsX: number;
  cellsZ: number;
}

/**
 * Worker ground per nav cell (NAV_RES per world cell): workers walk only on building land, the
 * cells with a build class (a flag up to a large house, or mine land); never on rough ground,
 * rock, cliffs, rivers, water, the massif or a cell a tree, bush or stone stands on.
 */
export const createWorkerGroundMask = (grid: BuildGrid, width: number, depth: number) => {
  const mask = new Uint8Array(width * depth);
  for (let row = 0; row < depth; row += 1) {
    const cellZ = Math.min(grid.cellsZ - 1, Math.floor(row / NAV_RES));
    for (let column = 0; column < width; column += 1) {
      const cellX = Math.min(grid.cellsX - 1, Math.floor(column / NAV_RES));
      mask[row * width + column] =
        grid.buildClass[cellZ * grid.cellsX + cellX] !== BUILD.none ? 1 : 0;
    }
  }
  return mask;
};

/** The base walkability (a conservative animal body) cut to the worker ground. */
const applyWorkerGround = (
  base: SpeciesNav,
  mask: Uint8Array,
  width: number,
  depth: number
) => {
  const ground = Uint8Array.from(base.ground, (value, cell) => value & mask[cell]!);
  const open = Uint8Array.from(base.open, (value, cell) => value & mask[cell]!);
  return { ...base, ground, open, ...labelRegions(open, width, depth) };
};

/**
 * The workers' navigation: the animal navigation's terrain and colliders with the worker
 * species' masks cut to building land. One mutable object: `refresh` re-reads the build class
 * (edits, felled trees) or takes a new base navigation (terrain edits) in place, so every
 * route, slot and collision test sees it at once.
 */
export const createWorkerNav = (world: WorldData, base: NavWorld, species: number) => {
  const nav: NavWorld = { ...base, species: [...base.species] };
  let source = base;
  const refresh = (next: NavWorld = source) => {
    source = next;
    const { depth, width } = next.terrain;
    const mask = createWorkerGroundMask(world, width, depth);
    nav.colliders = next.colliders;
    nav.terrain = next.terrain;
    nav.species = [...next.species];
    nav.species[species] = applyWorkerGround(next.species[species]!, mask, width, depth);
  };
  refresh();
  return { nav, refresh };
};

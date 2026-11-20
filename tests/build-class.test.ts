import { describe, expect, it } from "vitest";

import {
  releaseFelledProp,
  RIVER_CLEARANCE,
  ROCK_CLEARANCE
} from "../src/shared/world/build-class";
import { isBlockingProp } from "../src/shared/world/generation/gameplay";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createRoughGround } from "../src/shared/world/generation/rough-ground";
import { BLOCKING, BUILD, PROP } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128, erosionDroplets: 12000 };
const isHouse = (build: number) => build >= BUILD.small && build <= BUILD.large;

describe("build class", () => {
  const world = cachedWorld(SMALL);
  const rough = createRoughGround(world, world);

  it("offers nothing, not even a flag, on river beds, rock and harsh slopes", () => {
    const roughCells = [...rough.rough.keys()].filter((cell) => rough.rough[cell] === 1);
    expect(roughCells.length).toBeGreaterThan(100);
    expect(roughCells.every((cell) => world.buildClass[cell] === BUILD.none)).toBe(true);
  });

  it("keeps houses clear of the mountain rock and the rivers", () => {
    for (let cell = 0; cell < world.buildClass.length; cell += 1) {
      if (!isHouse(world.buildClass[cell]!)) continue;
      expect(rough.rockDistance[cell]).toBeGreaterThanOrEqual(ROCK_CLEARANCE.house);
      expect(rough.riverDistance[cell]).toBeGreaterThanOrEqual(RIVER_CLEARANCE);
    }
  });

  it("keeps houses clear of trees, bushes and stones", () => {
    for (let cell = 0; cell < world.buildClass.length; cell += 1) {
      if (!isHouse(world.buildClass[cell]!)) continue;
      const [x, z] = [cell % world.cellsX, Math.floor(cell / world.cellsX)];
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (x + dx < 0 || z + dz < 0 || x + dx >= world.cellsX || z + dz >= world.cellsZ)
            continue;
          const neighbour = (z + dz) * world.cellsX + x + dx;
          expect(world.blocking[neighbour]).not.toBe(BLOCKING.prop);
        }
      }
    }
  });

  it("frees a felled tree's cell and its neighbours' building room", () => {
    const felled = cachedWorld(SMALL);
    const { props } = felled;
    const cellOf = (index: number) =>
      Math.floor(props.z[index]!) * felled.cellsX + Math.floor(props.x[index]!);
    const sharesCell = (index: number) =>
      [...Array(props.count).keys()].some(
        (other) =>
          other !== index && isBlockingProp(props.types[other]!) && cellOf(other) === cellOf(index)
      );
    const tree = [...Array(props.count).keys()].find(
      // Generated home timber is pine/palm (owner 2026-10-18).
      (index) => props.types[index] === PROP.coniferTree && !sharesCell(index)
    )!;
    const cell = cellOf(tree);
    expect(felled.buildClass[cell]).toBe(BUILD.none);
    releaseFelledProp(felled, tree);
    expect(felled.blocking[cell]).toBe(BLOCKING.free);
    expect(felled.buildRevision).toBe(1);
    expect(felled.buildClass[cell]).toBeLessThanOrEqual(felled.buildCap[cell]!);
  });
});

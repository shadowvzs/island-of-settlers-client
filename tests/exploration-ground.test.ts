import { describe, expect, it, vi } from "vitest";

import { createExplorationGroundQuery } from "../src/app/exploration/ground";
import { BLOCKING, PROP, type WorldData } from "../src/shared/world/world-data";

const createWorld = () => {
  const cellsX = 4, cellsZ = 4;
  const world = {
    cellsX,
    cellsZ,
    blocking: new Uint8Array(cellsX * cellsZ),
    heights: new Float32Array((cellsX + 1) * (cellsZ + 1)),
    props: {
      count: 0,
      types: new Uint8Array(4),
      scale: new Float32Array(4).fill(1),
      x: new Float32Array(4),
      y: new Float32Array(4),
      z: new Float32Array(4)
    },
    walkCost: new Uint8Array(cellsX * cellsZ).fill(10),
    waterDepth: new Float32Array((cellsX + 1) * (cellsZ + 1))
  } as unknown as WorldData;
  return world;
};

const occupancy = () => ({ isOccupied: vi.fn(() => false), ownsTerritory: vi.fn(() => true) });

describe("exploration ground query", () => {
  it("samples vertex water depth instead of a cell-indexed height row", () => {
    const world = createWorld();
    // At (1.5, 1.5) the cell index is 5 but the bilinear vertex sample starts at 6. A positive
    // value at cell 5 used to mark this dry, flat cell as water.
    world.waterDepth[5] = 1;
    const ground = createExplorationGroundQuery(world, occupancy());

    expect(ground.isWater(1.5, 1.5)).toBe(false);
    expect(ground.isWalkable(1.5, 1.5)).toBe(true);
    expect(ground.isClear(1.5, 1.5, 0.16)).toBe(true);
  });

  it("steps onto low stones without making large rocks passable", () => {
    const world = createWorld();
    world.props.count = 1;
    world.props.types[0] = PROP.smallRock;
    world.props.x[0] = 1.5;
    world.props.z[0] = 1.5;
    const ground = createExplorationGroundQuery(world, occupancy());
    expect(ground.groundHeight(1.5, 1.5)).toBeCloseTo(0.35);
    expect(ground.isClear(1.5, 1.5, 0.16)).toBe(true);
  });

  it("still reports real water and blocked ground", () => {
    const world = createWorld();
    const waterCell = 2 * world.cellsX + 2;
    world.blocking[waterCell] = BLOCKING.water;
    world.walkCost[waterCell] = 0;
    world.waterDepth[2 * (world.cellsX + 1) + 2] = 1;
    const ground = createExplorationGroundQuery(world, occupancy());

    expect(ground.isWater(2.5, 2.5)).toBe(true);
    expect(ground.isWalkable(2.5, 2.5)).toBe(false);
    expect(ground.isClear(2.5, 2.5, 0.16)).toBe(false);
  });

  it("walks the shared bridge deck over the river at the deck height", () => {
    const world = createWorld();
    const waterCell = 2 * world.cellsX + 2;
    world.blocking[waterCell] = BLOCKING.water;
    world.walkCost[waterCell] = 0;
    world.waterDepth[2 * (world.cellsX + 1) + 2] = 1;
    // A deck strip along z = 2.5 from x = 0.5 to 3.5, 0.6 above the flat ground.
    const deck = (x: number, z: number) => Math.abs(z - 2.5) <= 0.5 && x >= 0.5 && x <= 3.5 ? 0.6 : undefined;
    const ground = createExplorationGroundQuery(world, occupancy(), deck);

    expect(ground.isWater(2.5, 2.5)).toBe(false);
    expect(ground.isWalkable(2.5, 2.5)).toBe(true);
    expect(ground.isClear(2.5, 2.5, 0.16)).toBe(true);
    expect(ground.groundHeight(2.5, 2.5)).toBeCloseTo(0.6);
    // Beside the deck the river is still water.
    expect(ground.isWater(2.5, 1.9)).toBe(true);
  });

  it("walks through saplings and other plants but keeps the tree trunk collision", () => {
    const world = createWorld();
    world.props.count = 3;
    world.props.types[0] = PROP.sapling;
    world.props.types[1] = PROP.willowShrub;
    world.props.types[2] = PROP.birchTree;
    world.props.x.set([1.5, 2.5, 1.5]);
    world.props.z.set([1.5, 1.5, 2.5]);
    const ground = createExplorationGroundQuery(world, occupancy());

    expect(ground.isClear(1.5, 1.5, 0.16)).toBe(true);
    expect(ground.isClear(2.5, 1.5, 0.16)).toBe(true);
    expect(ground.isClear(1.5, 2.5, 0.16)).toBe(false);
  });

  /** A shore along x: land for x < 2, water beyond it that deepens by 0.2 per cell. */
  const createShoreWorld = (riverDistance = 9) => {
    const world = createWorld();
    const stride = world.cellsX + 1;
    Object.assign(world, {
      coastDistance: new Float32Array(stride * (world.cellsZ + 1)),
      riverDistance: new Float32Array(stride * (world.cellsZ + 1)).fill(riverDistance)
    });
    for (let z = 0; z <= world.cellsZ; z++) for (let x = 0; x <= world.cellsX; x++) {
      world.coastDistance[z * stride + x] = 2 - x;
      world.waterDepth[z * stride + x] = Math.max(0, (x - 2) * 0.2);
    }
    for (let z = 0; z < world.cellsZ; z++) for (let x = 2; x < world.cellsX; x++) {
      world.blocking[z * world.cellsX + x] = BLOCKING.water;
      world.walkCost[z * world.cellsX + x] = 0;
    }
    return world;
  };

  it("wades about one tile into shallow shore water, never into deep water", () => {
    const ground = createExplorationGroundQuery(createShoreWorld(), occupancy());

    expect(ground.isWater(2.6, 1.5)).toBe(true);
    expect(ground.isWadeable?.(2.6, 1.5)).toBe(true);
    expect(ground.isClear(2.6, 1.5, 0.16)).toBe(true);
    expect(ground.isClear(1.8, 1.5, 0.16)).toBe(true);
    expect(ground.isWadeable?.(3.5, 1.5)).toBe(false);
    expect(ground.isClear(3.5, 1.5, 0.16)).toBe(false);
  });

  it("does not wade across river channels", () => {
    const ground = createExplorationGroundQuery(createShoreWorld(0.5), occupancy());

    expect(ground.isWadeable?.(2.6, 1.5)).toBe(false);
    expect(ground.isClear(2.6, 1.5, 0.16)).toBe(false);
  });
});

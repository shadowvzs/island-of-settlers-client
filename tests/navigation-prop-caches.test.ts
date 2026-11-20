import { describe, expect, it } from "vitest";

import { isBaseWorldNavigationClear, someObstacleNear } from "../src/shared/settlement/navigation-prop-geometry";
import { isGroundSegmentClear } from "../src/shared/settlement/settlement-navigation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { releaseFelledProp } from "../src/shared/world/build-class";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { appendProp } from "../src/shared/world/editing/prop-set";
import { addPropWalkCost, WALK_COST } from "../src/shared/world/generation/walkability";
import { explainWorldNavigationChange } from "../src/shared/world/navigation-change-log";
import { propIndexWork } from "../src/shared/world/prop-cell-index";
import { BLOCKING, BUILD, PROP, type PropSet, type WorldData } from "../src/shared/world/world-data";
import { preloadWorlds } from "./helpers/cached-worlds";
import { JOURNAL_WORLD_OPTIONS, journalIsland } from "./helpers/navigation-journal-fixture";

preloadWorlds(JOURNAL_WORLD_OPTIONS);

/** The owner's dense-forest target (D-S8): 1024² with 600,000 props. */
const FOREST_SIZE = 1024;
const FOREST_TREES = 600_000;
const tile = (x: number, z: number) => ({ maxX: x, maxZ: z, minX: x, minZ: z });

/** A flat 1024² island full of trees (every 97th a boulder), deterministic, no generation. */
const denseForest = () => {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const count = FOREST_TREES, cells = FOREST_SIZE * FOREST_SIZE;
  const types = new Uint8Array(count).fill(PROP.broadleafTree);
  for (let index = 0; index < count; index += 97) types[index] = PROP.largeRock;
  const coordinate = () => Math.min(FOREST_SIZE - .5, random() * FOREST_SIZE);
  const props: PropSet = { count, form: new Uint8Array(count), phase: new Float32Array(count),
    rotation: new Float32Array(count), scale: new Float32Array(count).fill(1), types,
    x: Float32Array.from({ length: count }, coordinate), y: new Float32Array(count),
    z: Float32Array.from({ length: count }, coordinate) };
  const world = { blocking: new Uint8Array(cells), buildCap: new Uint8Array(cells).fill(BUILD.large),
    buildClass: new Uint8Array(cells).fill(BUILD.large), buildRevision: 0, cellsX: FOREST_SIZE, cellsZ: FOREST_SIZE,
    props, slopeClass: new Uint8Array(cells), terrainRevision: 0,
    walkCost: new Uint8Array(cells).fill(WALK_COST.open) } as unknown as WorldData;
  for (let index = 0; index < count; index++) {
    const cell = Math.floor(props.z[index]!) * FOREST_SIZE + Math.floor(props.x[index]!);
    world.blocking[cell] = BLOCKING.prop;
    world.walkCost[cell] = addPropWalkCost(world.walkCost[cell]!, types[index]!);
  }
  return world;
};
/** Plants a sapling at a free cell's centre as the island hooks do: an explained change on its tile. */
const plantSapling = (world: WorldData, cell: number) => {
  const x = cell % world.cellsX + .5, z = Math.floor(cell / world.cellsX) + .5;
  return explainWorldNavigationChange(world, tile(Math.floor(x), Math.floor(z)), () => {
    const index = appendProp(world.props, { form: 0, phase: 0, rotation: 0, scale: 1, type: PROP.sapling, x, y: 0, z });
    world.blocking[cell] = BLOCKING.prop;
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    return index;
  });
};
/** A foot-sized probe beside a prop. */
const clearBeside = (world: WorldData, index: number) =>
  isBaseWorldNavigationClear(world, world.props.x[index]! + .4, world.props.z[index]! + .4, .3);
const freeCells = (world: WorldData, wanted: number) => {
  const cells: number[] = [];
  for (let cell = 1000; cells.length < wanted; cell += 7919) if (!world.blocking[cell]) cells.push(cell);
  return cells;
};

describe("S12 incremental prop obstacle index", () => {
  it("fells and plants in a 600k-tree forest without rebuilding, answering like a cold index", () => {
    const warm = denseForest();
    const felled = Array.from({ length: 200 }, (_, index) => (index * 3001) % FOREST_TREES);
    // Both indexes are built once up front: the cell index by the first felling, the obstacle index here.
    releaseFelledProp(warm, felled[0]!);
    someObstacleNear(warm, 1, 1, 1, () => false);
    const builds = propIndexWork.builds, appends = propIndexWork.appends;
    for (const index of felled.slice(1)) releaseFelledProp(warm, index);
    const cells = freeCells(warm, 50), planted = cells.map(cell => plantSapling(warm, cell));
    const answers = [...felled, ...planted].map(index => clearBeside(warm, index));
    expect(propIndexWork.builds).toBe(builds);
    expect(propIndexWork.appends).toBeGreaterThan(appends);
    const cold = denseForest();
    for (const index of felled) releaseFelledProp(cold, index);
    for (const cell of cells) plantSapling(cold, cell);
    expect(answers).toEqual([...felled, ...planted].map(index => clearBeside(cold, index)));
    for (const index of planted)
      expect(isBaseWorldNavigationClear(warm, warm.props.x[index]!, warm.props.z[index]!, .3)).toBe(false);
  });
});

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
/** Every half-grid edge result in a tile window, in one fixed order. */
const edgeAnswers = (context: SettlementContext, minX: number, minZ: number, maxX: number, maxZ: number) => {
  const answers: boolean[] = [];
  for (let az = minZ * 2; az <= maxZ * 2; az++)
    for (let ax = minX * 2; ax <= maxX * 2; ax++)
      for (const [dx, dz] of DIRECTIONS)
        answers.push(isGroundSegmentClear(context, { x: ax / 2, z: az / 2 }, { x: (ax + dx) / 2, z: (az + dz) / 2 }));
  return answers;
};
const WINDOW = [18, 16, 30, 28] as const;
const plantBesideRoute = (world: WorldData) => explainWorldNavigationChange(world, tile(22, 21), () => {
  expect(placeProp(world, { kind: PROP.broadleafTree, seed: 77, x: 22.5, z: 21.5 })).toBeTypeOf("number");
  world.buildRevision = (world.buildRevision ?? 0) + 1;
});

describe("A03 part b prop-edge cache", () => {
  it("answers like a cold cache after a felling, a planting and an unexplained change", () => {
    const island = journalIsland(), { context, trees, world } = island;
    const initial = edgeAnswers(context, ...WINDOW);
    releaseFelledProp(world, trees[1]!);
    plantBesideRoute(world);
    const warm = edgeAnswers(context, ...WINDOW);
    const cold = journalIsland();
    releaseFelledProp(cold.world, cold.trees[1]!);
    plantBesideRoute(cold.world);
    expect(warm).toEqual(edgeAnswers(cold.context, ...WINDOW));
    expect(warm).not.toEqual(initial);
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    expect(edgeAnswers(context, ...WINDOW)).toEqual(warm);
  });
});

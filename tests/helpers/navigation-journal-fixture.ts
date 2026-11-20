import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { makeBuilding } from "../../src/shared/settlement/settlement-placement";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import { placeProp } from "../../src/shared/world/editing/prop-placement";
import { DEFAULT_WORLD_OPTIONS } from "../../src/shared/world/generation/generate-world";
import { PROP, type WorldData } from "../../src/shared/world/world-data";
import { huntingWorld } from "./hunting-world";

/** World size of the journal island (big enough for a far corner outside every flow-field box). */
export const JOURNAL_ISLAND_SIZE = 96;
export const JOURNAL_WORLD_OPTIONS = { ...DEFAULT_WORLD_OPTIONS, cellsX: JOURNAL_ISLAND_SIZE,
  cellsZ: JOURNAL_ISLAND_SIZE, erosionDroplets: 0 };
/** The march every query follows: west to east past the woodcutter, trees and a boulder. */
export const ROUTE_FROM: SettlementPoint = { x: 10.5, z: 20.5 };
export const ROUTE_TO: SettlementPoint = { x: 40.5, z: 20.5 };

/** Tiles (half-open) where the stub road decoration takes the ground. */
interface DecorationBox { maxX: number; maxZ: number; minX: number; minZ: number }

export interface JournalIsland {
  context: SettlementContext;
  /** Far from the route: outside every query's read region. */
  farStore: SettlementBuilding;
  farTree: number;
  /** A placed road decoration (stub): its revision moves, the support test follows the box. */
  placeDecoration: (box: DecorationBox) => void;
  rocks: number[];
  /** Beside the route, its log pile in the corridor's read region. */
  woodcutter: SettlementBuilding;
  trees: number[];
  world: WorldData;
}

const prop = (world: WorldData, kind: number, x: number, z: number, seed: number) => {
  const id = placeProp(world, { kind, seed, x, z });
  if (typeof id !== "number") throw new Error(`No room for prop ${kind} at ${x}, ${z}`);
  return id;
};

/** A finished building with its plot and entrance occupied, like a completed placement. */
export const addFinishedBuilding = (context: SettlementContext, typeId: number, x: number, z: number) => {
  const building = makeBuilding(context, typeId, x, z);
  building.construction = 1;
  context.buildings.push(building);
  const { cellsX } = context.options.world;
  for (let cz = building.z - building.depth / 2; cz < building.z + building.depth / 2; cz++)
    for (let cx = building.x - building.width / 2; cx < building.x + building.width / 2; cx++)
      context.occupied[cz * cellsX + cx] = 1;
  return building;
};

/**
 * A flat island with buildings, trees, boulders and a stub road decoration owner: every input the
 * corridor, rider-tile and flow-field caches read. Fully deterministic, so a fresh copy with the
 * same changes applied is the cold reference of an incrementally updated one.
 */
export const journalIsland = (): JournalIsland => {
  const world = huntingWorld(JOURNAL_ISLAND_SIZE);
  const trees = [[20.5, 18.5], [24.5, 23.5], [33.5, 19.5], [36.5, 22.5]]
    .map(([x, z], index) => prop(world, PROP.broadleafTree, x!, z!, 11 + index));
  const rocks = [[29.5, 21.5], [15.5, 24.5]].map(([x, z], index) => prop(world, PROP.largeRock, x!, z!, 31 + index));
  const farTree = prop(world, PROP.broadleafTree, 80.5, 60.5, 41);
  let decorationRevision = 0;
  const boxes: DecorationBox[] = [];
  const roadDecorations = {
    isSupportClear: (point: SettlementPoint, radius = 0) => boxes.every(box =>
      point.x + radius <= box.minX || point.x - radius >= box.maxX || point.z + radius <= box.minZ ||
      point.z - radius >= box.maxZ),
    revision: () => decorationRevision
  };
  const context = { actors: [], buildings: [], navigationRevision: 0, nextBuilding: 1,
    occupied: new Uint8Array(JOURNAL_ISLAND_SIZE ** 2), options: { roads: createRoadNetwork(world), world },
    playerNation: "roman", reservations: new Set(), roadDecorations } as unknown as SettlementContext;
  const woodcutter = addFinishedBuilding(context, 17, 26, 15);
  const farStore = addFinishedBuilding(context, 33, 80, 80.5);
  woodcutter.output = { logs: 2 };
  farStore.output = { planks: 1 };
  const placeDecoration = (box: DecorationBox) => {
    boxes.push(box);
    decorationRevision++;
  };
  return { context, farStore, farTree, placeDecoration, rocks, trees, woodcutter, world };
};

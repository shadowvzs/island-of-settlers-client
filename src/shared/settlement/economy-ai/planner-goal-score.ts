import { isStandingBlocker } from "../../world/build-class";
import { createPropCellIndex } from "../../world/prop-cell-index";
import { BLOCKING, PROP, SLOPE, type WorldData } from "../../world/world-data";
import {
  FARM_TYPE_ID, FLAX_FARM_TYPE_ID, FORESTER_TYPE_ID, QUARRY_TYPE_ID, WOODCUTTER_TYPE_ID
} from "../building-type-ids";
import { TREE_TYPES } from "../settlement-resources";
import type { SettlementContext } from "../settlement-types";
import { FIELD_SAMPLE_RADIUS, RESOURCE_SAMPLE_CAP, RESOURCE_SAMPLE_RADIUS } from "./constants";

/**
 * The goal score of a candidate plot (plan §3.5): what its building's work needs within reach. Standing trees
 * for a woodcutter, large rocks for a quarry, free field cells for a farm or forester; other types score 0 and keep the
 * cache's depot-distance order. Counts are capped integers over a fixed square, so the score is cheap and exact.
 * Resource knowledge is the island's for now; EAI3c's per-faction discovered bitset narrows it.
 */
const trees = createPropCellIndex(type => TREE_TYPES.has(type));
/** The quarry works large rocks only (`findWorkTarget`). */
const rocks = createPropCellIndex(type => type === PROP.largeRock);

/** The running count of one sample (module scratch: the visitors allocate nothing per call). */
let counted = 0;
/** The count a sample stops at: the score's cap, or 1 for a yes/no question. */
let countCap = RESOURCE_SAMPLE_CAP;
let sampledWorld: WorldData | undefined;
const countStandingTree = (prop: number) => isStandingBlocker(sampledWorld!, prop) && ++counted >= countCap;
const countRock = () => ++counted >= countCap;

const sampleRect = { maxX: 0, maxZ: 0, minX: 0, minZ: 0 };
const squareAround = (centerX: number, centerZ: number, radius: number) => {
  sampleRect.minX = Math.floor(centerX) - radius; sampleRect.maxX = Math.floor(centerX) + radius;
  sampleRect.minZ = Math.floor(centerZ) - radius; sampleRect.maxZ = Math.floor(centerZ) + radius;
  return sampleRect;
};

const countProps = (world: WorldData, index: typeof trees, visit: (prop: number) => boolean, centerX: number,
  centerZ: number) => {
  counted = 0;
  sampledWorld = world;
  index.someInRect(world, squareAround(centerX, centerZ, RESOURCE_SAMPLE_RADIUS), visit);
  sampledWorld = undefined;
  return counted;
};

/** Cells round the plot a field could use: no building, no blocker, not steep. */
const countFieldCells = (context: SettlementContext, centerX: number, centerZ: number) => {
  const { world } = context.options, { cellsX, cellsZ } = world;
  const rect = squareAround(centerX, centerZ, FIELD_SAMPLE_RADIUS);
  let count = 0;
  for (let z = Math.max(0, rect.minZ); z <= Math.min(cellsZ - 1, rect.maxZ); z++)
    for (let x = Math.max(0, rect.minX); x <= Math.min(cellsX - 1, rect.maxX); x++) {
      const cell = z * cellsX + x;
      if (context.occupied[cell] === 0 && world.blocking[cell] === BLOCKING.free &&
        (world.slopeClass?.[cell] ?? 0) <= SLOPE.gentle && ++count >= RESOURCE_SAMPLE_CAP) return count;
    }
  return count;
};

/** A woodcutter or quarry works only the trees or rocks in its reach: a plot without any is no use to it. */
export const needsResources = (typeId: number) => typeId === WOODCUTTER_TYPE_ID || typeId === QUARRY_TYPE_ID;

/** Whether a woodcutter or quarry plot centred on (centerX, centerZ) has one tree or rock in reach (stops at it). */
export const plotHasResource = (context: SettlementContext, typeId: number, centerX: number, centerZ: number) => {
  countCap = 1;
  const found = plotResourceScore(context, typeId, centerX, centerZ) > 0;
  countCap = RESOURCE_SAMPLE_CAP;
  return found;
};

/** The resources within reach of a plot centred on (centerX, centerZ) for a building of `typeId`. */
export const plotResourceScore = (context: SettlementContext, typeId: number, centerX: number, centerZ: number) => {
  const { world } = context.options;
  if (typeId === WOODCUTTER_TYPE_ID) return countProps(world, trees, countStandingTree, centerX, centerZ);
  if (typeId === QUARRY_TYPE_ID) return countProps(world, rocks, countRock, centerX, centerZ);
  if (typeId === FARM_TYPE_ID || typeId === FLAX_FARM_TYPE_ID || typeId === FORESTER_TYPE_ID)
    return countFieldCells(context, centerX, centerZ);
  return 0;
};

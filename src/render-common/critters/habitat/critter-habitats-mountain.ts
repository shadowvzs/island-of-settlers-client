import { MATERIAL, type WorldData } from "../../../shared/world/world-data";
import { getSlopeAt, type HabitatScore,toPoint } from "./critter-habitats";
import { getMaterialShare } from "./critter-terrain";

/** Steeper than this a chamois leaves it to the rock skin's walls (rise per run). */
export const CHAMOIS_SLOPE = 0.95;
/** Peaks an eagle circles start at the snow line. */
const PEAK_HEIGHT = 7;
const PEAK_RANGE = 4;

/** Rock, scree and the mine gravel ring of a vertex (0..1). */
const getStonyShare = (world: WorldData, vertex: number) =>
  getMaterialShare(world, vertex, MATERIAL.rock) +
  getMaterialShare(world, vertex, MATERIAL.gravel) +
  getMaterialShare(world, vertex, MATERIAL.mine);

const getGrassShare = (world: WorldData, vertex: number) =>
  getMaterialShare(world, vertex, MATERIAL.grass) +
  getMaterialShare(world, vertex, MATERIAL.lushGrass);

/**
 * Rocky slopes, scree and the mine gravel ring around the mountains (chamois): dry stony ground
 * not steeper than a chamois path; slopes score above flat gravel.
 */
export const scoreRockySlope: HabitatScore = (terrain, vertex) => {
  const { world } = terrain;
  if (world.waterDepth[vertex]! > 0.01 || getStonyShare(world, vertex) < 0.5) return 0;
  const slope = getSlopeAt(world, vertex);
  if (slope > CHAMOIS_SLOPE) return 0;
  return 0.6 + 0.4 * Math.min(1, slope / 0.6);
};

/**
 * Open grass at the mountain foot (marmot burrows): gentle dry meadow, no stone ground itself,
 * mountain rock or gravel within about 8 cells, hardly any trees.
 */
export const scoreMountainFoot: HabitatScore = (terrain, vertex) => {
  const { world } = terrain;
  if (world.waterDepth[vertex]! > 0.01 || getGrassShare(world, vertex) < 0.5) return 0;
  if (getStonyShare(world, vertex) > 0.2 || getSlopeAt(world, vertex) > 0.45) return 0;
  const { x, z } = toPoint(world, vertex);
  const rocky = terrain.rocky(x, z);
  if (rocky < 0.25 || terrain.forest(x, z) > 0.2) return 0;
  return Math.min(1, rocky * 1.5);
};

/** High peaks (eagles circle over them): higher scores better. */
export const scorePeak: HabitatScore = ({ world }, vertex) => {
  const height = world.heights[vertex]!;
  if (height < PEAK_HEIGHT) return 0;
  return Math.min(1, 0.2 + (height - PEAK_HEIGHT) / PEAK_RANGE);
};

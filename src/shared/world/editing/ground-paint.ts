import { DMath } from "../../math/deterministic-math";
import { type CellRegion, EMPTY_REGION, getCellsRegion, unionRegions } from "../grid-geometry";
import { readSplatWeights, writeSplatWeights } from "../ground-buffer";
import { GROUND_VARIANT_COUNT, getGroundVariantOfTile } from "../ground-variants";
import { MATERIAL, MATERIAL_COUNT, NO_MINE_ZONE, type WorldData } from "../world-data";
import { type Brush,getBrushWeight, getVertexRangeCells, listPaintedCells } from "./brush";
import { addMineLand, removeMineLand } from "./mine-land";

export interface GroundBrush extends Brush {
  material: number;
  /** Share of the way to the material per stamp at full cover (0..1). */
  strength: number;
}

export interface GroundPaint {
  /** Cells whose ground (corner splat) or mine land changed. */
  cells: CellRegion;
  /** Cells that became mine land or stopped being it (empty region when none). */
  mineCells: CellRegion;
  /** Mine zones whose cells changed. */
  zoneIds: Set<number>;
}

/** Splat weights of the vertex being painted (reused, no allocation per vertex). */
const weights = new Float32Array(MATERIAL_COUNT);

/**
 * Moves `amount` (0..1) of the weights towards the material; the total stays, so the written
 * bytes stay normalised.
 */
export const blendTowardMaterial = (target: Float32Array, material: number, amount: number) => {
  let total = 0;
  for (let index = 0; index < MATERIAL_COUNT; index += 1) {
    total += target[index]!;
    target[index] = target[index]! * (1 - amount);
  }
  target[material] = target[material]! + total * amount;
};

/**
 * Moves the painted variant bytes of a vertex: towards 255 on the painted variant, towards 0 on every variant when
 * a splat material is painted over it (the new ground replaces the overlay).
 */
const paintVariantBytes = (variants: Uint8Array, vertex: number, variant: number, amount: number) => {
  for (let channel = 0; channel < GROUND_VARIANT_COUNT; channel += 1) {
    const index = vertex * GROUND_VARIANT_COUNT + channel;
    const target = channel === variant ? 255 : variants[index]! * (variant < 0 ? 0 : 1);
    variants[index] = Math.round(variants[index]! + (target - variants[index]!) * amount);
  }
};

/** Vertex range of a brush (clamped to the grid). */
const getBrushVertexRange = (world: WorldData, brush: Brush) => ({
  maxX: Math.min(world.cellsX, Math.floor(brush.x + brush.radius)),
  maxZ: Math.min(world.cellsZ, Math.floor(brush.z + brush.radius)),
  minX: Math.max(0, Math.ceil(brush.x - brush.radius)),
  minZ: Math.max(0, Math.ceil(brush.z - brush.radius))
});

/** Paints the splat of every vertex under the brush; returns the vertex range it touched. */
export const paintVertices = (world: WorldData, brush: GroundBrush) => {
  const range = getBrushVertexRange(world, brush);
  const variant = getGroundVariantOfTile(brush.material);
  const stride = world.cellsX + 1;
  for (let vertexZ = range.minZ; vertexZ <= range.maxZ; vertexZ += 1) {
    for (let vertexX = range.minX; vertexX <= range.maxX; vertexX += 1) {
      const cover = getBrushWeight(brush, DMath.hypot(vertexX - brush.x, vertexZ - brush.z));
      if (cover <= 0) continue;
      const vertex = vertexZ * stride + vertexX;
      if (world.groundVariants) paintVariantBytes(world.groundVariants, vertex, variant, cover * brush.strength);
      if (variant >= 0) continue;
      readSplatWeights(world.splat, vertex, weights);
      blendTowardMaterial(weights, brush.material, cover * brush.strength);
      writeSplatWeights(world.splat, vertex, weights);
    }
  }
  return range;
};

/**
 * Mine gravel makes the painted cells mine land (barren); any other ground takes it (and its
 * ore) away.
 */
const paintMineLand = (world: WorldData, brush: GroundBrush) => {
  const painted = listPaintedCells(world, brush).map(({ cell }) => cell);
  const isMine = brush.material === MATERIAL.mine;
  const changing = painted.filter((cell) => (world.mineZone[cell] !== NO_MINE_ZONE) !== isMine);
  const zoneIds = isMine ? addMineLand(world, changing) : removeMineLand(world, changing);
  return { mineCells: getCellsRegion(world, changing), zoneIds };
};

/**
 * One stamp of the ground brush (map editor): the vertices under it blend towards the material
 * by their brush cover, the splat stays normalised; mine gravel adds mine land, other ground
 * removes it. Pure on the world data (serialisable as the brush values).
 */
export const paintGround = (world: WorldData, brush: GroundBrush): GroundPaint => {
  const vertices = paintVertices(world, brush);
  if (getGroundVariantOfTile(brush.material) >= 0)
    return { cells: getVertexRangeCells(world, vertices), mineCells: EMPTY_REGION, zoneIds: new Set() };
  const { mineCells, zoneIds } = paintMineLand(world, brush);
  const cells = unionRegions(getVertexRangeCells(world, vertices), mineCells);
  return { cells, mineCells, zoneIds };
};

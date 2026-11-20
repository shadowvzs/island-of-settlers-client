import { smoothstep } from "../../shared/world/noise";
import { toByte } from "../color";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { ROCK_ROLE, type RockInstance } from "./rock-instances";
import type { RockLibrary, RockShape } from "./rock-shapes";
import { getWetness, type RockTerrain } from "./rock-terrain";
import { getRockChunk } from "./rock-tiles";
import { getLooseCover, getOverhang, getUpward, getWeathering } from "./rock-zones";

/**
 * Merged rock geometry (one draw call per chunk). mask: R stone tint + detail flag
 * (packTintByte), G moss, B loose cover
 * (gravel / soil), A cavity; extra: R macro form (255 skin, 0 library rocks), G fog visibility, B weathering
 * (0 clean exposed .. 1 weathered rock), A wet rock (spray, splash: darker, glossier, mossy).
 */
export interface RockMeshData {
  extra: Uint8Array;
  indices: Uint32Array;
  lodIndices?: Uint32Array;
  mask: Uint8Array;
  normals: Float32Array;
  positions: Float32Array;
  triangles: number;
  vertexCount: number;
}

/**
 * extra.r of the sculpted skin: its broad planes follow the landform (macro-normal-map.ts);
 * library rocks (0) keep their own form.
 */
export const MACRO_FORM_SKIN = 255;
const ORE_SHIFT = 16;

/**
 * mask.r byte: the "detailed stone" flag in the high bit; below it the stone tint 0..1 in 7 bits,
 * or for a detailed stone its ore (3 bits) and the tint in 4 bits. Flag and ore are constant per
 * stone, so interpolation never mixes them (the skin's tint varies, it keeps the 7 bits).
 */
export const packTintByte = (tint: number, detailed: boolean, ore = 0) => {
  const unitTint = Math.min(1, Math.max(0, tint));
  if (!detailed) return Math.round(unitTint * 127);
  return 128 + ore * ORE_SHIFT + Math.round(unitTint * (ORE_SHIFT - 1));
};

const transform = (
  axes: RockInstance["axes"],
  centre: Vec3,
  x: number,
  y: number,
  z: number
): Vec3 => [
  centre[0] + axes[0][0] * x + axes[1][0] * y + axes[2][0] * z,
  centre[1] + axes[0][1] * x + axes[1][1] * y + axes[2][1] * z,
  centre[2] + axes[0][2] * x + axes[1][2] * y + axes[2][2] * z
];

/** Normals of a stretched shape: divide by the axis lengths squared (inverse transpose). */
const transformNormal = (
  axes: RockInstance["axes"],
  lengths: Vec3,
  x: number,
  y: number,
  z: number
) =>
  normalize(
    transform(
      axes,
      [0, 0, 0],
      x / (lengths[0] * lengths[0]),
      y / (lengths[1] * lengths[1]),
      z / (lengths[2] * lengths[2])
    )
  );

interface VertexMasks {
  cavity: number;
  loose: number;
  moss: number;
  tint: number;
  weathering: number;
}

/**
 * Masks of one vertex in the world: moss on upward faces (and more in crevices of mossy rock),
 * gravel and soil where the stone meets the ground and on its top, cavity in creases, under
 * overhangs and at ground contact, weathering from the formation's exposure.
 */
const getMasks = (
  rock: RockInstance,
  position: Vec3,
  normal: Vec3,
  shapeCavity: number,
  terrain: RockTerrain
): VertexMasks => {
  const aboveGround = position[1] - terrain.height(position[0], position[2]);
  /** Soil reaches a third of a small stone's height at most (pebbles stay stone, not gravel). */
  const soilDepth = Math.min(0.35, Math.hypot(...rock.axes[1]) * 0.35);
  const contact = smoothstep(soilDepth, -0.05, aboveGround);
  const upward = getUpward(normal[1]);
  const overhang = getOverhang(normal[1]);
  const cavity = Math.max(shapeCavity, contact * 0.55, overhang * 0.6);
  const moisture = terrain.moisture(position[0], position[2]);
  return {
    cavity,
    loose: getLooseCover(contact, upward * 0.6),
    moss: Math.min(1, rock.moss * (upward * 0.9 + shapeCavity * 0.6 + contact * 0.4)),
    tint: rock.tint * 0.5 + 0.5,
    weathering: getWeathering({ cavity, exposure: rock.exposure, moisture, upward })
  };
};

const appendRock = (
  target: RockMeshData,
  offset: { index: number; vertex: number },
  rock: RockInstance,
  shape: RockShape,
  terrain: RockTerrain
) => {
  const lengths = rock.axes.map((axis) => Math.hypot(...axis)) as unknown as Vec3;
  const first = offset.vertex;
  const count = shape.positions.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const [x, y, z] = [
      shape.positions[vertex * 3]!,
      shape.positions[vertex * 3 + 1]!,
      shape.positions[vertex * 3 + 2]!
    ];
    const position = transform(rock.axes, rock.centre, x, y, z);
    const normal = transformNormal(
      rock.axes,
      lengths,
      shape.normals[vertex * 3]!,
      shape.normals[vertex * 3 + 1]!,
      shape.normals[vertex * 3 + 2]!
    );
    const masks = getMasks(rock, position, normal, shape.cavity[vertex]!, terrain);
    const at = first + vertex;
    target.positions.set(position, at * 3);
    target.normals.set(normal, at * 3);
    target.mask.set(
      [
        packTintByte(masks.tint, rock.detailed ?? false, rock.ore),
        toByte(masks.moss),
        toByte(masks.loose),
        toByte(masks.cavity)
      ],
      at * 4
    );
    target.extra.set(
      [
        0,
        toByte(terrain.visibility(position[0], position[2])),
        toByte(masks.weathering),
        toByte(getWetness(terrain, position[0], position[2]))
      ],
      at * 4
    );
  }
  for (let index = 0; index < shape.indices.length; index += 1) {
    target.indices[offset.index + index] = first + shape.indices[index]!;
  }
  offset.vertex += count;
  offset.index += shape.indices.length;
};

/** Shape of a rock at a detail level (far LOD always uses the low detail shapes). */
const getShape = (library: RockLibrary, rock: RockInstance, detail: "auto" | "low") => {
  const shapes = library[rock.family]![rock.variant]!;
  if (rock.role === ROCK_ROLE.pebble) return shapes.pebble;
  return detail === "low" || !rock.high ? shapes.low : shapes.high;
};

/** Rubble and contact pebbles: the small pieces a far view drops (distance LOD). */
export const isSmallRock = (rock: RockInstance) =>
  rock.role === ROCK_ROLE.rubble || rock.role === ROCK_ROLE.pebble;

/** Merges rocks into one mesh; `skipRubble` drops the small pieces and pebbles (far LOD). */
export const buildRockMesh = (
  rocks: RockInstance[],
  library: RockLibrary,
  terrain: RockTerrain,
  options: { detail: "auto" | "low"; skipRubble: boolean }
): RockMeshData => {
  const kept = options.skipRubble ? rocks.filter((rock) => !isSmallRock(rock)) : rocks;
  const shapes = kept.map((rock) => getShape(library, rock, options.detail));
  const vertexCount = shapes.reduce((sum, shape) => sum + shape.positions.length / 3, 0);
  const indexCount = shapes.reduce((sum, shape) => sum + shape.indices.length, 0);
  const data: RockMeshData = {
    extra: new Uint8Array(vertexCount * 4),
    indices: new Uint32Array(indexCount),
    mask: new Uint8Array(vertexCount * 4),
    normals: new Float32Array(vertexCount * 3),
    positions: new Float32Array(vertexCount * 3),
    triangles: indexCount / 3,
    vertexCount
  };
  const offset = { index: 0, vertex: 0 };
  kept.forEach((rock, index) => appendRock(data, offset, rock, shapes[index]!, terrain));
  return data;
};

/** Rocks grouped by terrain chunk (chunk culling; see getRockChunk). */
export const groupRocksByChunk = (rocks: RockInstance[], chunksX: number) => {
  const groups = new Map<number, RockInstance[]>();
  for (const rock of rocks) {
    const chunk = getRockChunk(rock, chunksX);
    const list = groups.get(chunk) ?? [];
    list.push(rock);
    groups.set(chunk, list);
  }
  return groups;
};

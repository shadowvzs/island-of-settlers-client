import { clamp01 } from "../../../shared/world/noise";
import type { Vec3 } from "../../props/mesh-builder";
import { SPECIES } from "../wildlife-species";
import { type AnimalModel,JOINT, PART } from "./animal-rig";

/** Spot pattern of a species (adult model space): cell size and spot colour strength. */
export interface CoatSpots {
  cell: number;
  color: Vec3;
  /** Warm juvenile coat tint at full warmth. */
  warm: Vec3;
}

export const COAT_SPOTS: Record<number, CoatSpots> = {
  [SPECIES.deer]: { cell: 0.036, color: [0.96, 0.93, 0.86], warm: [1.12, 0.93, 0.8] },
  [SPECIES.elk]: { cell: 0.07, color: [0.86, 0.76, 0.6], warm: [1.08, 0.95, 0.84] }
};

/** Where spots may sit, and how densely: back, sides, rump; fewer on neck and upper legs. */
const SPOT_DENSITY: Record<number, number> = {
  [PART.body]: 1,
  [PART.rear]: 1,
  [PART.neck]: 0.35,
  [PART.frontLeftUpper]: 0.45,
  [PART.frontRightUpper]: 0.45,
  [PART.hindLeftUpper]: 0.45,
  [PART.hindRightUpper]: 0.45
};

const hash = (x: number, y: number, z: number, salt: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + salt * 19.19) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Irregular spots: the nearest jittered feature point of a 3D cell grid, each spot with its own
 * size and elongation along the body (never round stamps, never repeating), some cells empty.
 */
export const getSpotMask = (position: Vec3, cell: number) => {
  const cx = Math.floor(position[0] / cell);
  const cy = Math.floor(position[1] / cell);
  const cz = Math.floor(position[2] / cell);
  let mask = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        const z = cz + dz;
        if (hash(x, y, z, 1) > 0.88) continue;
        const fx = (x + hash(x, y, z, 2)) * cell - position[0];
        const fy = (y + hash(x, y, z, 3)) * cell - position[1];
        const fz = (z + hash(x, y, z, 4)) * cell - position[2];
        const stretch = 1.2 + hash(x, y, z, 5) * 0.6;
        const distance = Math.hypot(fx / stretch, fy, fz);
        const radius = cell * (0.2 + hash(x, y, z, 6) * 0.16);
        const wobble = Math.sin(fx * 300 + fz * 260) * radius * 0.15;
        mask = Math.max(mask, 1 - clamp01((distance + wobble - radius * 0.7) / (radius * 0.3)));
      }
    }
  }
  return mask;
};

/** The same spots in GLSL (Three shades them per pixel in rest space). */
export const COAT_SPOTS_GLSL = `
float spotHash(vec3 cell, float salt) {
  return fract(sin(cell.x * 127.1 + cell.y * 311.7 + cell.z * 74.7 + salt * 19.19) * 43758.5453);
}

float getSpotMask(vec3 position, float cellSize) {
  vec3 base = floor(position / cellSize);
  float mask = 0.0;
  for (int dz = -1; dz <= 1; dz++) {
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec3 cell = base + vec3(dx, dy, dz);
        if (spotHash(cell, 1.0) > 0.88) continue;
        vec3 jitter = vec3(spotHash(cell, 2.0), spotHash(cell, 3.0), spotHash(cell, 4.0));
        vec3 f = (cell + jitter) * cellSize - position;
        float stretch = 1.2 + spotHash(cell, 5.0) * 0.6;
        float radius = cellSize * (0.2 + spotHash(cell, 6.0) * 0.16);
        float wobble = sin(f.x * 300.0 + f.z * 260.0) * radius * 0.15;
        float distance = length(vec3(f.x / stretch, f.y, f.z));
        mask = max(mask, 1.0 - clamp((distance + wobble - radius * 0.7) / (radius * 0.3), 0.0, 1.0));
      }
    }
  }
  return mask;
}
`;

/** Per vertex 0..1: spots only on the upper body (back and sides), not the belly or head. */
export const computeSpotRegion = (model: AnimalModel) => {
  const rootHeight = model.joints[JOINT.root]![1];
  const { normals, positions } = model.mesh;
  const region = new Float32Array(model.parts.length);
  for (let vertex = 0; vertex < region.length; vertex += 1) {
    const density = SPOT_DENSITY[model.parts[vertex]!] ?? 0;
    if (density === 0 || model.fur[vertex * 4 + 3] === 0) continue;
    const y = positions[vertex * 3 + 1]!;
    const upper =
      clamp01((normals[vertex * 3 + 1]! + 0.2) / 0.3) *
      clamp01((y - rootHeight * 0.88) / (rootHeight * 0.08));
    region[vertex] = upper * density;
  }
  return region;
};

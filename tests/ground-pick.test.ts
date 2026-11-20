import { describe, expect, it } from "vitest";

import { createVertexFog, RENDER_SUBDIVISION } from "../src/render-common/chunk-sampling";
import {
  PICK_HEIGHT_RANGE,
  type PickGround,
  pickGroundAlongRay,
  type PickPoint
} from "../src/render-common/ground-pick";
import { createFaceUpright } from "../src/render-common/rocks/face-upright";
import { buildChunk, CHUNK_CELLS, type ChunkVertexData } from "../src/render-common/terrain-chunks";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { cachedWorld } from "./helpers/cached-worlds";
import { getIsoViewRay, projectIsoToViewport } from "./iso-view";

const SIZE = 48;
const PEAK = { height: 9, radius: 7, x: 20, z: 20 };
const PIT = { depth: 3, radius: 5, x: 34, z: 30 };

/** Gentle ground with a steep peak on a render vertex and a lake pit (the editor's relief). */
const createGround = (): PickGround => {
  const heights = new Float32Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const peak = Math.max(0, 1 - Math.hypot(x - PEAK.x, z - PEAK.z) / PEAK.radius);
      const pit = Math.max(0, 1 - Math.hypot(x - PIT.x, z - PIT.z) / PIT.radius);
      heights[z * SIZE + x] = 1 + 0.2 * Math.sin(x * 0.7) + peak * PEAK.height - pit * PIT.depth;
    }
  }
  return { cellsX: SIZE, cellsZ: SIZE, heights };
};

const ground = createGround();

/** A drawn render vertex: on the smooth heights. */
const vertexAt = (x: number, z: number): PickPoint => ({
  x,
  y: sampleSmooth(ground, ground.heights, x, z),
  z
});

const normalize = ({ x, y, z }: PickPoint) => {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
};

/** View directions: the iso view, rotated and lower cinematic cameras, straight down. */
const DIRECTIONS = [
  normalize({ x: -1, y: -1.15, z: -1 }),
  normalize({ x: 1, y: -0.9, z: -0.4 }),
  normalize({ x: 0.3, y: -0.45, z: 1 }),
  normalize({ x: -0.7, y: -2, z: 0.2 }),
  { x: 0, y: -1, z: 0 }
];

/** A ray that ends at `target`, coming from 60 units up the line. */
const rayTo = (target: PickPoint, direction: PickPoint) => ({
  direction,
  origin: {
    x: target.x - direction.x * 60,
    y: target.y - direction.y * 60,
    z: target.z - direction.z * 60
  }
});

/** Nearest hit of a ray on a chunk's drawn triangles (Moller-Trumbore), as a GPU raycast does. */
const raycastChunk = (chunk: ChunkVertexData, { direction, origin }: ReturnType<typeof rayTo>) => {
  const corner = (index: number) => ({
    x: chunk.positions[index * 3]!,
    y: chunk.positions[index * 3 + 1]!,
    z: chunk.positions[index * 3 + 2]!
  });
  const sub = (a: PickPoint, b: PickPoint) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const cross = (a: PickPoint, b: PickPoint) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  });
  const dot = (a: PickPoint, b: PickPoint) => a.x * b.x + a.y * b.y + a.z * b.z;
  let nearest = Infinity;
  for (let index = 0; index < chunk.indices.length; index += 3) {
    const a = corner(chunk.indices[index]!);
    const edge1 = sub(corner(chunk.indices[index + 1]!), a);
    const edge2 = sub(corner(chunk.indices[index + 2]!), a);
    const p = cross(direction, edge2);
    const det = dot(edge1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(origin, a);
    const u = dot(s, p) / det;
    const q = cross(s, edge1);
    const v = dot(direction, q) / det;
    const t = dot(edge2, q) / det;
    if (u >= 0 && v >= 0 && u + v <= 1 && t > 0) nearest = Math.min(nearest, t);
  }
  return nearest;
};

const distance = (a: PickPoint, b: PickPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("ground picking", () => {
  it("hits the peak vertex exactly (a ray through a vertex never slips between triangles)", () => {
    const peak = vertexAt(PEAK.x, PEAK.z);
    for (const direction of DIRECTIONS) {
      const hit = pickGroundAlongRay(ground, rayTo(peak, direction));
      expect(hit && distance(hit, peak)).toBeLessThan(1e-6);
    }
  });

  it("never passes a drawn point: each vertex picks itself or ground in front of it", () => {
    const step = 1 / RENDER_SUBDIVISION;
    for (const direction of DIRECTIONS) {
      for (let z = 4; z <= SIZE - 4; z += step) {
        for (let x = 4; x <= SIZE - 4; x += step) {
          const target = vertexAt(x, z);
          const ray = rayTo(target, direction);
          const hit = pickGroundAlongRay(ground, ray);
          expect(hit).not.toBeNull();
          const before = distance(ray.origin, target) - distance(ray.origin, hit!);
          expect(before).toBeGreaterThan(-1e-6);
        }
      }
    }
  });

  it("picks raised slopes and the lake floor where they are seen from above", () => {
    const points = [vertexAt(17, 17), vertexAt(21.5, 18), vertexAt(PIT.x, PIT.z)];
    for (const point of points) {
      const hit = pickGroundAlongRay(ground, rayTo(point, { x: 0, y: -1, z: 0 }));
      expect(hit && distance(hit, point)).toBeLessThan(1e-6);
    }
  });

  it("follows the iso view: a ground point on screen picks back to itself", () => {
    const view = { centerX: 24, centerZ: 24, viewportHeight: 900, viewportWidth: 1500, zoom: 1.1 };
    for (const point of [vertexAt(30, 12), vertexAt(PIT.x, PIT.z + 2), vertexAt(10, 30)]) {
      const pixel = projectIsoToViewport(view, point.x, point.y, point.z);
      const ray = getIsoViewRay(view, pixel.x, pixel.y, PICK_HEIGHT_RANGE.max);
      const hit = pickGroundAlongRay(ground, ray);
      expect(hit && distance(hit, point)).toBeLessThan(1e-4);
    }
  });

  /**
   * Upright rock faces (rocks/face-upright.ts) draw tall steep faces moved toward their lip; their
   * cells are blocked cliffs and picking keeps the heightfield there (owner rule: picking uses the
   * heightfield), so the drawn-triangle match is checked wherever the surface does not move.
   */
  it("hits the triangles the terrain chunks draw (a generated island)", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64 });
    const chunk = buildChunk(world, createVertexFog(world), 1, 1, "terrain")!;
    const upright = createFaceUpright(world, { maxX: CHUNK_CELLS * 2, maxZ: CHUNK_CELLS * 2, minX: CHUNK_CELLS,
      minZ: CHUNK_CELLS });
    const shift = new Float32Array(2);
    const moves = (x: number, z: number) => [-1, 0, 1].some(dz => [-1, 0, 1].some(dx => {
      upright.shift(x + dx, z + dz, shift);
      return Math.hypot(shift[0]!, shift[1]!) > 1e-6;
    }));
    const direction = normalize({ x: 0.15, y: -1, z: -0.1 });
    for (let z = CHUNK_CELLS + 3.3; z < CHUNK_CELLS * 2 - 3; z += 1.7) {
      for (let x = CHUNK_CELLS + 3.1; x < CHUNK_CELLS * 2 - 3; x += 1.3) {
        if (moves(x, z)) continue;
        const ray = rayTo({ x, y: sampleSmooth(world, world.heights, x, z), z }, direction);
        const hit = pickGroundAlongRay(world, ray)!;
        expect(Math.abs(distance(ray.origin, hit) - raycastChunk(chunk, ray))).toBeLessThan(1e-3);
      }
    }
  });

  it("misses off the map", () => {
    const ray = { direction: { x: 0, y: -1, z: 0 }, origin: { x: -3, y: 20, z: 10 } };
    expect(pickGroundAlongRay(ground, ray)).toBeNull();
    const away = { direction: normalize({ x: -1, y: -0.2, z: 0 }), origin: { x: 2, y: 20, z: 10 } };
    expect(pickGroundAlongRay(ground, away)).toBeNull();
  });
});

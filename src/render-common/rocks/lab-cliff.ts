import { createFbm, smoothstep } from "../../shared/world/noise";
import { deriveSeed } from "../../shared/world/rng";
import type { Geology } from "./geology";
import type { RockTerrain } from "./rock-terrain";

export interface CliffOptions {
  /** 0 crisp and steep .. 1 eroded: softer foot, more talus, rounder top. */
  erosion: number;
  geology: Geology;
  /** Face height in world units (a gameplay height step is 1.1). */
  height: number;
  seed: number;
}

export const LAB_SIZE = 48;

/**
 * A test terrain for one cliff formation: a plateau whose edge winds across the map, a face
 * whose height changes broadly along its length (the top silhouette steps and dips), an
 * occasional shelf part way up, a talus apron at the foot and gently rolling ground.
 */
export const createLabCliffTerrain = (options: CliffOptions): RockTerrain => {
  const edgeNoise = createFbm(deriveSeed(options.seed, "edge"), { octaves: 3 });
  const heightNoise = createFbm(deriveSeed(options.seed, "face-height"), { octaves: 2 });
  const shelfNoise = createFbm(deriveSeed(options.seed, "shelf"), { octaves: 2 });
  const groundNoise = createFbm(deriveSeed(options.seed, "ground"), { octaves: 4 });
  /** Mountain flanks lean back like the island's ridges; other cliffs stand near vertical. */
  const slant = options.geology === "mountain" ? 3 : 1;
  const width = (0.35 + options.erosion * 1.2 + options.height * 0.06) * slant;
  /** 0 on the plateau .. 1 on the floor; where the shelf noise is high the face has a ledge. */
  const getDrop = (along: number, shelf: number) => {
    const straight = smoothstep(-0.5, 0.5, along);
    const stepped = smoothstep(-0.5, -0.12, along) * 0.45 + smoothstep(0.12, 0.5, along) * 0.55;
    return straight + (stepped - straight) * shelf;
  };
  const height = (x: number, z: number) => {
    const edge = LAB_SIZE * 0.45 + edgeNoise(x * 0.04, 1.7) * 7 + Math.sin(x * 0.11) * 2;
    const face = options.height * (1 + heightNoise(x * 0.06, 3.1) * 0.45);
    const along = (z - edge) / width;
    const shelf = smoothstep(0.05, 0.3, shelfNoise(x * 0.08, 5.3));
    const talus = smoothstep(0.4, 0.4 + 6 * (0.3 + options.erosion), along) * 0.12 * face;
    const plateau = face + groundNoise(x * 0.08, z * 0.08) * 0.25;
    const fade = 1 - smoothstep(0.5, 8, along) * 0.4;
    const floor = groundNoise(x * 0.07 + 9, z * 0.07) * 0.3 + talus * fade;
    return plateau + (floor - plateau) * getDrop(along, shelf);
  };
  return {
    cellsX: LAB_SIZE,
    cellsZ: LAB_SIZE,
    height: (x, z) => height(x, z),
    moisture: (x, z) => 0.45 + groundNoise(x * 0.05 + 4, z * 0.05) * 0.4,
    mountain: () => (options.geology === "mountain" ? 1 : 0),
    visibility: () => 1
  };
};

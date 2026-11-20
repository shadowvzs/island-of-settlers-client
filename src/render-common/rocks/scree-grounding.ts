import type { RockInstance } from "./rock-instances";
import type { RockShape } from "./rock-shapes";
import { isInWater, type RockTerrain } from "./rock-terrain";

/** Fit render-only scree to its actual shape, leaving foundations and channels clear. */
export const groundScreeStone = (
  stone: RockInstance,
  shape: RockShape,
  terrain: RockTerrain,
  isKeptClear?: (x: number, z: number) => boolean
): RockInstance | null => {
  const { axes, centre } = stone;
  const height = Math.hypot(...axes[1]);
  const burial = height * 0.08;
  let groundedY = Infinity;
  let highestAboveGround = -Infinity;
  for (let index = 0; index < shape.positions.length; index += 3) {
    const x = shape.positions[index]!;
    const y = shape.positions[index + 1]!;
    const z = shape.positions[index + 2]!;
    const px = centre[0] + axes[0][0] * x + axes[1][0] * y + axes[2][0] * z;
    const pz = centre[2] + axes[0][2] * x + axes[1][2] * y + axes[2][2] * z;
    if (terrain.isBuildLand?.(px, pz) || isKeptClear?.(px, pz) || isInWater(terrain, px, pz))
      return null;
    const offsetY = axes[0][1] * x + axes[1][1] * y + axes[2][1] * z;
    const ground = terrain.height(px, pz);
    highestAboveGround = Math.max(highestAboveGround, offsetY - ground);
    // Bury the whole lower half, rather than balancing a tilted shape on one centre sample.
    if (y <= 0) groundedY = Math.min(groundedY, ground - offsetY - burial);
  }
  if (!Number.isFinite(groundedY)) return null;
  // A very steep/concave contact can swallow a small chip: omit it instead of adding a sliver.
  if (groundedY + highestAboveGround <= height * 0.15) return null;
  return { ...stone, centre: [centre[0], groundedY, centre[2]] };
};

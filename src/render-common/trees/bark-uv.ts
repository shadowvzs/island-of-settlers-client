import type { Vec2, Vec3 } from "../props/mesh-builder";

/**
 * Bark coordinates on island tree wood: stored as u = -BARK_UV_OFFSET - family x
 * BARK_FAMILY_STRIDE - around, so every consumer that treats u < 0 as "untextured" (sprite
 * baker, shadow pass) keeps the plain bark colour, while the prop shader recognises
 * u < BARK_UV_LIMIT, reads the bark family and draws its relief.
 * around: 0..1 around the limb (plus a twist, which must stay below the stride); along: limb
 * length in circumferences.
 */
export const BARK_UV_OFFSET = 2;
export const BARK_UV_LIMIT = -1.5;
export const BARK_FAMILY_STRIDE = 8;

/** Procedural bark families of the Three prop shader (three-tree-shading.ts). */
export const BARK_FAMILY = {
  oak: 0,
  spruce: 1,
  mountainPine: 3,
  birch: 4,
  /** Coconut palm: smooth grey trunk with irregular leaf scar rings. */
  palmRinged: 5,
  /** Date palm: staggered rows of cut old leaf bases. */
  palmLeafBase: 6,
  /** Fan palm: rough fibrous trunk, vertical fibres and faint rings. */
  palmFibrous: 7,
  /**
   * Shore shells (three-shell-shading.ts, checked before the bark families): ribbed bivalve
   * outsides, nacre/porcelain insides, sea star skin and spiral (snail, whelk) shells.
   */
  shellBivalve: 8,
  shellNacre: 9,
  seaStar: 10,
  spiralShell: 11
} as const;

/**
 * Birch branches start their along coordinate this many circumferences up, so the shader's
 * rough trunk base (along below about 2.5) only shows on the trunk foot.
 */
export const BIRCH_BRANCH_ALONG = 6;

export const toBarkUv = (around: number, along: number, family = 0): Vec2 => [
  -BARK_UV_OFFSET - family * BARK_FAMILY_STRIDE - around,
  along
];

/** Distance along a limb at every point, in circumferences (the bark's isotropic unit). */
export const getLimbAlong = (points: readonly Vec3[], radii: readonly number[]) => {
  const along: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[index - 1]!;
    const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const radius = (radii[index]! + radii[index - 1]!) / 2;
    along.push(along[index - 1]! + length / (Math.PI * 2 * Math.max(radius, 0.005)));
  }
  return along;
};

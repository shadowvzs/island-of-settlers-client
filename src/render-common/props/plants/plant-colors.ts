import type { Random } from "../../../shared/world/rng";
import type { Vec3, VertexStyle } from "../mesh-builder";

/** A green family: about 20 % dark, 60 % base, 20 % light leaves, plus dead material. */
export interface Palette {
  base: Vec3;
  dark: Vec3;
  dry: Vec3;
  light: Vec3;
}

/** Wetland: yellow-green and olive, straw dry stalks. */
export const RIVER_GREENS: Palette = {
  base: [0.4, 0.47, 0.17],
  dark: [0.25, 0.32, 0.12],
  dry: [0.66, 0.56, 0.32],
  light: [0.58, 0.64, 0.27]
};

/** Forest understory: cooler deep greens, brown dead leaves. */
export const FOREST_GREENS: Palette = {
  base: [0.2, 0.33, 0.15],
  dark: [0.11, 0.21, 0.1],
  dry: [0.42, 0.29, 0.15],
  light: [0.33, 0.47, 0.21]
};

/** Meadow: fresh grass greens (tinted by the ground per instance), tan dry blades. */
export const FIELD_GREENS: Palette = {
  base: [0.6, 0.74, 0.3],
  dark: [0.42, 0.56, 0.2],
  dry: [0.8, 0.7, 0.42],
  light: [0.78, 0.88, 0.42]
};

/**
 * Leaf card tints (multiply the painted leaf sprays): river olive, forest shrubs a mid olive
 * (between the light grass and the deeper, bluer tree crowns), field fresh.
 */
export const CARD_TINTS = {
  field: [1.2, 1.22, 0.9],
  forest: [1.04, 1, 1.02],
  river: [1.22, 1.14, 0.72]
} as const satisfies Record<string, Vec3>;

export const BARK = {
  grey: [0.5, 0.46, 0.4],
  red: [0.5, 0.3, 0.2],
  woody: [0.4, 0.3, 0.2]
} as const satisfies Record<string, Vec3>;

const jitterColor = (color: Vec3, random: Random, amount: number): Vec3 => {
  const factor = 1 - amount / 2 + random() * amount;
  const warm = 1 + (random() - 0.5) * amount * 0.5;
  return [color[0] * factor * warm, color[1] * factor, (color[2] * factor) / warm];
};

/** One leaf or blade colour from a family: mostly base, some darker, some sunlit, a few dry. */
export const pickTone = (palette: Palette, random: Random, dryChance = 0): Vec3 => {
  const roll = random();
  if (roll < dryChance) return jitterColor(palette.dry, random, 0.12);
  const tone = (roll - dryChance) / (1 - dryChance);
  if (tone < 0.2) return jitterColor(palette.dark, random, 0.08);
  if (tone < 0.8) return jitterColor(palette.base, random, 0.08);
  return jitterColor(palette.light, random, 0.08);
};

export interface ShadeOptions {
  /** Brightness at the ground (moisture, overlapping stems, leaf litter shade). */
  floor: number;
  /** Height where the darkening has faded out. */
  reach: number;
}

const ROOT_SHADE: ShadeOptions = { floor: 0.45, reach: 0.18 };

/** Darker, lower root zone of the dense waterside clumps (cattail, reeds, river shrubs). */
export const RIVER_ROOT_SHADE: ShadeOptions = { floor: 0.38, reach: 0.16 };

/**
 * Plant colour with root zone occlusion: darker near the soil, full colour above `reach`, a
 * little jitter per vertex. Flutter comes from the vertex wind of plant parts.
 */
export const shaded = (
  color: Vec3,
  random: Random,
  shade: ShadeOptions = ROOT_SHADE,
  jitter = 0.08
): VertexStyle => ({
  color: ([, y]) => {
    const lift = Math.min(1, Math.max(0, y / shade.reach));
    const factor = (shade.floor + (1 - shade.floor) * lift) * (1 - jitter / 2 + random() * jitter);
    return [color[0] * factor, color[1] * factor, color[2] * factor];
  },
  flutter: 0
});

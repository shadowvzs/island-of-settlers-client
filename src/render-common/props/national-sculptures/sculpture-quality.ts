import type { SculptureRecipe } from "./sculpture-recipe";

export type SculptureTier = "hero" | "ornament";
const SAMPLING = {
  hero: { high: { fine: true, phoenix: 56, wings: 48, qilin: 60 },
    minimal: { fine: false, phoenix: 24, wings: 20, qilin: 23 } },
  ornament: { high: { fine: false, phoenix: 34, wings: 28, qilin: 34 },
    minimal: { fine: false, phoenix: 12, wings: 11, qilin: 16 } },
} as const;
export const sculptureSampling = (detailed: boolean, tier: SculptureTier) =>
  SAMPLING[tier][detailed ? "high" : "minimal"];

/** The same authored anatomy/silhouette with sparse small details for a distant miniature. */
export const finishSculptureTier = (recipe: SculptureRecipe, tier: SculptureTier): SculptureRecipe => {
  if (tier === "hero" || recipe.detailed) return recipe;
  const counts = new Map<string, number>();
  const every = (name: string, step: number) => ((counts.get(name) ?? 1) - 1) % step === 0;
  const omitted = new Set(["qilin_nasal_rim", "qilin_cheek_scroll", "qilin_cheek_mane", "qilin_pupil",
    "phoenix_nostril", "phoenix_cere", "phoenix_pupil", "phoenix_amber_iris", "phoenix_thigh", "phoenix_rear_talon", "phoenix_breast_plumage", "phoenix_layered_covert", "phoenix_talon_claw"]);
  const parts = recipe.parts.filter(part => {
    counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
    if (omitted.has(part.name)) return false;
    if (part.name === "qilin_flank_scale") return every(part.name, 4);
    if (part.name === "qilin_flowing_mane") return every(part.name, 2);
    if (part.name === "qilin_flowing_beard" || part.name === "qilin_throat_scale" ||
      part.name === "qilin_tail_tassel") return every(part.name, 3);
    if (part.name === "phoenix_flowing_tail") return (counts.get(part.name)! - 1) % 3 !== 1;
    if (part.name === "phoenix_neck_plumage") return every(part.name, 3);
    return true;
  }).map(part => {
    const shape = part.geometry.shape;
    if (shape.kind === "tube") {
      const segments = 3, radii = Array.from({ length: segments + 1 }, (_, index) => {
        const position = index / segments * shape.segments, low = Math.floor(position);
        const high = Math.min(shape.segments, low + 1), blend = position - low;
        return shape.radii[low]! * (1 - blend) + shape.radii[high]! * blend;
      });
      let points = shape.points;
      if (part.name === "phoenix_talon_toe") {
        const x = points.at(-1)![0];
        points = [...points, [x, -.027, .167], [x, -.033, .15]];
        radii[radii.length - 1] = .0008;
      }
      return { ...part, geometry: { ...part.geometry, shape: { ...shape, points, segments, radii, sides: 4 } } };
    }
    if (shape.kind === "ellipsoid")
      return { ...part, geometry: { ...part.geometry, shape: { ...shape, segments: 5 } } };
    if (shape.kind === "loft")
      return { ...part, geometry: { ...part.geometry, shape: { ...shape, sides: 4 } } };
    return part;
  });
  return { ...recipe, parts };
};

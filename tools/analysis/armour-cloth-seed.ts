import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import type { ClothControlVertex } from "./armour-cloth-controls";

/** Seed coarse cloth from the fitted physical High surface. Keep its geometry/topology and
 * independently pinned neck/hand shares; only permitted existing joint slots are interpolated. */
export const seedArmourClothWeights = (target: ClothControlVertex[], source: { vertices: ClothControlVertex[]; indices: number[] }) => {
  const grid = new TriangleGrid(source.vertices.map(vertex => vertex.rest), source.indices);
  let maximumDistance = 0, maximumOmittedShare = 0, seeded = 0, skipped = 0;
  for (const group of target) {
    if (!group.movable) continue;
    const hit = grid.closestPoint(group.rest, .025);
    if (!hit) { skipped++; continue; }
    const skin = new Map<string, number>();
    const barycentric = hit.bary.map(weight => Math.max(0, weight)), barycentricTotal = barycentric.reduce((sum, weight) => sum + weight, 0);
    for (let corner = 0; corner < 3; corner++) {
      const vertex = source.vertices[source.indices[hit.triangle * 3 + corner]!]!;
      vertex.bones.forEach((name, slot) => skin.set(name,
        (skin.get(name) ?? 0) + vertex.weights[slot]! * barycentric[corner]! / barycentricTotal));
    }
    maximumDistance = Math.max(maximumDistance, hit.distance);
    maximumOmittedShare = Math.max(maximumOmittedShare, [...skin].reduce((sum, [name, weight]) =>
      sum + (group.bones.includes(name) ? 0 : weight), 0));
    const fixed = new Set(group.fixedSlots), fixedTotal = group.weights.reduce((sum, weight, slot) =>
      sum + (fixed.has(slot) ? weight : 0), 0);
    const available = group.bones.reduce((sum, name, slot) => sum + (fixed.has(slot) ? 0 : skin.get(name) ?? 0), 0);
    // Near an armhole/collar the closest High face may belong to another control region.
    // Keep the original coarse cloth there; optional seeding is never ownership authority.
    if (available < .5) { skipped++; continue; }
    group.weights = group.weights.map((weight, slot) => fixed.has(slot) ? weight
      : (skin.get(group.bones[slot]!) ?? 0) / available * (1 - fixedTotal));
    seeded++;
  }
  if (!seeded) throw new Error("No corresponding coarse shoulder controls could be seeded");
  return { seeded, skipped, maximumDistance, maximumOmittedShare };
};

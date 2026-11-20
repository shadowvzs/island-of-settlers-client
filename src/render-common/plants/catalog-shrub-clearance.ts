import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import { type CatalogShrubPoint, createCatalogShrubGraph, shrubMix } from "./catalog-shrub-graph";

interface ShrubClearanceBox { min: CatalogShrubPoint; max: CatalogShrubPoint }
const envelope = (a: CatalogShrubPoint, b: CatalogShrubPoint, radius: number): ShrubClearanceBox => ({
  min: [Math.min(a[0], b[0]) - radius, Math.min(a[1], b[1]) - radius, Math.min(a[2], b[2]) - radius],
  max: [Math.max(a[0], b[0]) + radius, Math.max(a[1], b[1]) + radius, Math.max(a[2], b[2]) + radius]
});
/** Authored shoot/lamina/flower envelopes union both accepted near qualities.
 * Individual rooted bearing stems stay thin: foliage never gains an artificial box down to the ground. */
export const catalogShrubClearance = (asset: PlantDecorationAsset): readonly ShrubClearanceBox[] => {
  const boxes: ShrubClearanceBox[] = [];
  if (asset.potted) boxes.push({ min: [-.115, 0, -.115], max: [.115, .238, .115] });
  for (const detailed of [true, false]) {
    const graph = createCatalogShrubGraph(asset.species, asset.variant, asset.potted, detailed);
    const compact = asset.species.includes("boxwood") || asset.species === "round-myrtle";
    let leafReach = graph.definition.leafLength * 1.20 + .016;
    if (compact) leafReach = graph.definition.leafLength * 1.12 + .016;
    if (asset.species.endsWith("-rose") || asset.species === "marigold") leafReach *= 1.10;
    for (const shoot of graph.shoots) {
      boxes.push(envelope(shoot.start, shoot.end, .008));
      boxes.push(envelope(shrubMix(shoot.start, shoot.end, .35),
        shrubMix(shoot.start, shoot.end, 1), leafReach));
      if (!shoot.flowering) continue;
      let flowerReach = .024;
      if (asset.species.endsWith("-rose")) flowerReach = .079;
      if (asset.species === "hydrangea") flowerReach = .094;
      if (asset.species === "azalea") flowerReach = .078;
      if (asset.species === "hibiscus") flowerReach = .105;
      if (asset.species === "marigold") flowerReach = .066;
      const flower = envelope(shoot.end, shoot.end, flowerReach);
      if (asset.species === "lavender") flower.max[1] += .116;
      if (asset.species === "rosemary") flower.max[1] += .053;
      boxes.push(flower);
    }
  }
  return boxes;
};
export const catalogFlowerClearance = catalogShrubClearance;

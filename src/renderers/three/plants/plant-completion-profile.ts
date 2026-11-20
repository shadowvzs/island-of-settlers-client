import { plantCompletionModelFamily } from "../../../../../island-of-settlers-shared/src/road-plant-completion";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";

type Costs = readonly [high: number, minimal: number, far: number];
/** Actual frozen maxima over the three structural variants; no shared scene budget is increased. */
const speciesCosts: Readonly<Partial<Record<PlantDecorationAsset["species"], Costs>>> = {
  "date-palm": [14360, 3848, 2288], "fan-palm": [2164, 1148, 932],
  "dwarf-coconut": [9876, 2556, 1792], "olive-standard": [17344, 3396, 1652],
  "orange-standard": [17608, 3200, 1456], "acacia-standard": [22236, 5560, 1600],
  "italian-stone-pine": [20516, 5036, 1508],
  boxwood: [12000, 5780, 2], "golden-boxwood": [12000, 5780, 2],
  "round-boxwood": [12000, 5780, 2], "round-myrtle": [12000, 5780, 2],
  myrtle: [8392, 4560, 2], azalea: [8784, 4640, 2],
  "white-rose": [11864, 5800, 2], "red-rose": [11864, 5800, 2],
  lavender: [11432, 5896, 2], rosemary: [8196, 5092, 2], hibiscus: [10608, 5446, 2],
  hydrangea: [11482, 5936, 2], marigold: [11832, 5572, 2]
};

const completionCosts = (asset: PlantDecorationAsset): Costs | undefined => {
  const family = plantCompletionModelFamily(asset);
  if (!family) return undefined;
  if (family === "catalog-bonsai") return [9550, 4870, 1888];
  if (family === "catalog-flowering") {
    if (asset.species === "red-maple") return [10856, 3990, 2];
    if (asset.species === "double-peach")
      return asset.form === "standalone" ? [18436, 5666, 2] : [17900, 5580, 2];
    if (asset.species === "cherry-blossom" || asset.species === "white-cherry") return [22776, 5948, 2];
    return asset.form === "standalone" ? [21956, 5646, 2] : [21420, 5566, 2];
  }
  if (family === "catalog-willow")
    return asset.species === "silver-willow" ? [19988, 5752, 1296] : [14004, 4528, 984];
  if (family === "catalog-columnar") {
    if (asset.species === "columnar-cypress") return [19696, 5882, 2116];
    if (asset.species === "italian-poplar") return asset.potted ? [19024, 5600, 1348] : [18464, 5296, 1044];
    if (asset.species === "juniper-spire") return asset.potted ? [21040, 5882, 2116] : [20480, 5578, 1812];
    throw new Error(`Missing columnar LOD cost: ${asset.species}`);
  }
  const costs = speciesCosts[asset.species];
  if (!costs) throw new Error(`Missing botanical LOD cost: ${asset.species}`);
  return costs;
};

export const plantCompletionProfile = (asset: PlantDecorationAsset, detailed: boolean, overview: boolean) => {
  const costs = completionCosts(asset);
  if (!costs) return undefined;
  const family = plantCompletionModelFamily(asset)!;
  const large = family !== "catalog-shrub" && family !== "catalog-flower" && family !== "catalog-bonsai";
  return { large, cost: costs[detailed ? 0 : 1], farCost: costs[2], overview };
};

import { buildingEntry } from "@shared/catalog";
import { buildingGeometry } from "@shared/catalog/building-data/geometry";
import {
  buildingNavigationLevel, loadBuildingNavigation, loadedBuildingNavigation
} from "@shared/catalog/building-data/navigation";
import { beforeAll, describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import {
  computeBuildingGeometry, computeBuildingNavigationLevel
} from "../src/render-common/buildings/building-geometry-reference";
import {
  buildingStockNavigationVolumesFromData, getBuildingNavigationData
} from "../src/render-common/buildings/building-navigation-data";
import {
  buildingStockNavigationVolumes, getBuildingNavigationProfile
} from "../src/render-common/buildings/building-navigation-profile";
import { BUILDING_LEVELS } from "../src/render-common/buildings/levels/building-level";
import { PLAYER_NATIONS } from "../src/render-common/workers/worker-appearance";

/**
 * Permanent geometry contract (CAT8, catalog plan §10.3): the stored sidecars equal what the recipes produce for
 * every building × nation × level. After a model change run `npm run building-geometry` (part of building-assets).
 */
/** JSON with sorted object keys: exact numbers (-0 as stored), key order ignored. */
const stored = (value: unknown) => JSON.stringify(value, (_, item: unknown) => item && typeof item === "object" &&
  !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const keyOf = (code: number) => buildingEntry(code)!.key;

/** Counts that fill every stock slot partly and completely, for every ware the recipe stocks. */
const countSets = (typeId: number, nation: (typeof PLAYER_NATIONS)[number]) => {
  const wares = new Set<string>();
  for (const part of getBuildingNavigationProfile(typeId, nation, 1).recipe.parts)
    if (part.stock) for (const ware of [part.stock.ware, ...(part.stock.wares ?? [])]) wares.add(ware);
  return [1, 3, 99].map(count => Object.fromEntries([...wares].map(ware => [ware, count])));
};

const expectSameStock = (typeId: number, nation: (typeof PLAYER_NATIONS)[number], level: 1 | 5) => {
  const profile = getBuildingNavigationProfile(typeId, nation, level);
  const data = getBuildingNavigationData(typeId, nation, level);
  for (const counts of countSets(typeId, nation))
    for (const [input, output] of [[counts, {}], [{}, counts], [counts, counts]])
      expect(stored(buildingStockNavigationVolumesFromData(data, input!, output!)),
        `${keyOf(typeId)}/${nation}/${level}`)
        .toBe(stored(buildingStockNavigationVolumes(profile, input!, output!)));
};

describe("building geometry contract (recipes vs stored sidecars)", () => {
  beforeAll(async () => {
    for (const nation of PLAYER_NATIONS) await loadBuildingNavigation(nation);
  });

  it("stores every building's placement geometry", () => {
    for (const definition of BUILDING_CATALOG)
      expect(stored(buildingGeometry(definition.id)), keyOf(definition.id))
        .toBe(stored(computeBuildingGeometry(definition)));
  });

  it("stores every building's walkable area per nation and level", () => {
    for (const definition of BUILDING_CATALOG) for (const nation of PLAYER_NATIONS) {
      const file = loadedBuildingNavigation(keyOf(definition.id), nation);
      expect(file, `${keyOf(definition.id)}/${nation}`).toBeDefined();
      for (const level of BUILDING_LEVELS)
        expect(stored(buildingNavigationLevel(file!, level)), `${keyOf(definition.id)}/${nation}/${level}`)
          .toBe(stored(computeBuildingNavigationLevel(definition.id, nation, level)));
    }
  });

  it("seats the same live stock solids as the recipe presentation", () => {
    for (const definition of BUILDING_CATALOG) for (const nation of PLAYER_NATIONS)
      for (const level of [1, 5] as const) expectSameStock(definition.id, nation, level);
  });
});

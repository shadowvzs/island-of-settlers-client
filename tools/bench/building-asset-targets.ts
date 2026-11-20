import { buildingEntries, entriesOfKind } from "@shared/catalog";

import type { WorkerNation } from "../../src/render-common/workers/worker-nation";

/**
 * What the building asset pipeline renders, read from the content catalog: every active `building:*` entry (code
 * order, so base buildings precede their advanced material variants) for every nation of its `nation` axis. Icon
 * files come from the entry's `icon` template (`nationalBuildingIconPath`), models from its `model.recipe`
 * (`render-common/content/building-model-recipes.ts`).
 */
export const buildingAssetCodes = (): readonly number[] =>
  buildingEntries().map(entry => entry.code).sort((first, second) => first - second);

/** The nations every building is exported for (catalog nation order; Roman first). */
export const buildingAssetNations = (): readonly WorkerNation[] =>
  entriesOfKind("nation").map(entry => entry.key as WorkerNation);

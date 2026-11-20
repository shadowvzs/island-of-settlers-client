import { MeshStandardMaterial } from "three";
import { vi } from "vitest";

import type { BuildingSurface } from "../../src/render-common/buildings/building-recipe";

/** Every surface once: `satisfies` keeps the list complete, so merged meshes count every part. */
const SURFACES = {
  "indigenous-rubble":true,"japanese-bamboo":true,"japanese-white-stone":true,"japanese-catapult-stone":true,
  "chinese-red-brick":true,
  amber: true, bark: true, bread: true, cloth: true, "cloth-water": true, "cloth-council": true,
  "hide-hunt": true, "hide-mountains": true, "hide-reeds": true, "hide-sun": true,
  "cloth-reeds": true, "tanning-liquid": true, "cloth-patched": true, "cloth-hide-trim": true,
  copper: true, "cut-stone": true, dark: true,
  endgrain: true, "feed-grain": true, "feed-water": true, fish: true, gold: true, hide: true, iron: true,
  leaf: true, mosaic: true, paint: true, planks: true, plaster: true, roof: true, "roof-shingles": true,
  "nubian-decor": true, "nubian-textile": true, "roof-slate": true, "roof-thatch": true, "palm-thatch": true, "palm-trunk": true, rope: true, sacking: true, steel: true, stone: true, straw: true,
  wood: true
} satisfies Record<BuildingSurface, true>;

/** Plain materials for every building surface (geometry and triangle counts, not looks). */
export const createPlainBuildingMaterials = () => Object.fromEntries(Object.keys(SURFACES)
  .map(surface => [surface, new MeshStandardMaterial()])) as Record<BuildingSurface, MeshStandardMaterial>;

/** A do-nothing value: any property, call or construction gives itself back, and it reads as 0. */
const inert: unknown = new Proxy(() => undefined, {
  apply: () => inert,
  construct: () => inert as object,
  get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : inert),
  set: () => true
});

/** Pixel holder for `putImageData` into the inert canvas. */
class InertImageData {
  constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
}

/**
 * Node has no canvas: owned painted materials (the Japanese dragon lacquer, the catapult and
 * rubble mineral textures) paint into an inert canvas and image, so whole models build for geometry
 * counts. Call it per test (globals are unstubbed after each).
 */
export const stubPaintCanvas = () => {
  vi.stubGlobal("document", inert);
  vi.stubGlobal("ImageData", InertImageData);
};

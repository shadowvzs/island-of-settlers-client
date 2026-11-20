import { getTreeSpecies } from "../../src/render-common/props/island-trees";
import { getMeshId, getVariantCount, PROP_KIND_COUNT } from "../../src/render-common/props/prop-mesh-layout";
import { PROP_MESH_SEED } from "../../src/render-common/props/prop-mesh-seed";
import { createPropMesh } from "../../src/render-common/props/prop-meshes";
import { installBiomeGrassPayload } from "../../src/render-common/props/plants/biome-grass-mesh";

/** Exact visual metadata at the same native seed used by three-vegetation; trees own their existing separate table. */
export const measurePropClearanceBounds = () => {
  // This module is bundled into a data URL by prop-clearance-bounds.ts; pass the payload through
  // globalThis so the bundled copy gets the same bytes without relying on import.meta.dirname.
  const payload = (globalThis as { __BIOME_GRASS_PAYLOAD__?: ArrayBuffer }).__BIOME_GRASS_PAYLOAD__;
  if (!payload) throw new Error("Biome grass payload missing for prop clearance measurement");
  installBiomeGrassPayload(payload);
  const rows: Record<number, number[]> = {};
  for (let kind = 0; kind < PROP_KIND_COUNT; kind++) {
    if (getTreeSpecies(kind) !== undefined) continue;
    for (let variant = 0; variant < getVariantCount(kind); variant++) {
      const mesh = createPropMesh(PROP_MESH_SEED, kind, variant);
      let sway = 0, flutter = 0, low = 0;
      for (let index = 0; index < mesh.wind.length; index += 2) {
        sway = Math.max(sway, mesh.wind[index]!); flutter = Math.max(flutter, mesh.wind[index + 1]!);
      }
      for (let index = 1; index < mesh.positions.length; index += 3) low = Math.min(low, mesh.positions[index]!);
      const values = [mesh.height, mesh.radius, sway, flutter, low];
      if (!values.every(Number.isFinite)) throw new Error(`Invalid native prop bounds ${kind}/${variant}`);
      rows[getMeshId(kind, variant)] = values.map((value, index) => index === 4 ? Math.floor(value * 1e6) / 1e6 : (Math.ceil(value * 1e6) + 1) / 1e6);
    }
  }
  return rows;
};

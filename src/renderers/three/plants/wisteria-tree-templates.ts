import { type Texture, TextureLoader } from "three";

import { wisteriaAtlasBounds,type WisteriaLodAtlasMetadata } from "../wisteria-lod-atlas";
import { createWisteriaTreeMaterials, createWisteriaTreeModel, type WisteriaTreeMaterials,
  type WisteriaTreeTier } from "./wisteria-tree-model";

export interface WisteriaTreeAtlas {
  texture: Texture;
  tissue: Texture;
  metadata: WisteriaLodAtlasMetadata;
}
const releaseAtlas = (texture: Texture) => { texture.dispose(); texture.image = null; };

/** Tree-specific original albedo bake of canonical botany; each owner gets an independent TextureSource. */
export const loadWisteriaTreeAtlas = async (): Promise<WisteriaTreeAtlas> => {
  const results = await Promise.allSettled([
    new TextureLoader().loadAsync(new URL("../../../../assets/botanical-textures/wisteria-tree-lod-albedo.png",
      import.meta.url).href),
    new TextureLoader().loadAsync(new URL("../../../../assets/botanical-textures/wisteria-neutral-atlas-candidate.png",
      import.meta.url).href),
    fetch(new URL("../../../../assets/botanical-textures/wisteria-tree-lod-albedo.json", import.meta.url).href)
      .then(response => {
        if (!response.ok) throw new Error(`Wisteria tree atlas metadata: ${response.status}`);
        return response.json() as Promise<WisteriaLodAtlasMetadata>;
      })
  ]);
  const [texture, tissue, metadata] = results;
  if (texture.status === "fulfilled" && tissue.status === "fulfilled" && metadata.status === "fulfilled")
    return { texture: texture.value, tissue: tissue.value, metadata: metadata.value };
  if (texture.status === "fulfilled") releaseAtlas(texture.value);
  if (tissue.status === "fulfilled") releaseAtlas(tissue.value);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  throw new Error("Wisteria tree atlas did not load");
};

const validateAtlas = (metadata: WisteriaLodAtlasMetadata) => {
  if (metadata.version !== 2 || ![metadata.racemeSpan, metadata.spraySpan]
    .every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid Wisteria tree atlas metadata");
  wisteriaAtlasBounds(metadata.raceme); wisteriaAtlasBounds(metadata.spray);
};

/** Refcounted per-map/quality botanical surfaces; pending loads, retries and late teardown share one owner. */
export const createWisteriaTreeTemplates = (detailed: boolean,
  loadAtlas: () => Promise<WisteriaTreeAtlas> = loadWisteriaTreeAtlas) => {
  let pending: Promise<WisteriaTreeMaterials> | undefined;
  let materials: WisteriaTreeMaterials | undefined, users = 0, disposed = false;
  const release = () => {
    users--;
    if (users !== 0) return;
    materials?.dispose(); materials = undefined; pending = undefined;
  };
  const acquire = () => {
    if (!pending) pending = loadAtlas().then(atlas => {
      if (disposed) {
        releaseAtlas(atlas.texture); releaseAtlas(atlas.tissue);
        throw new Error("Wisteria tree template owner is disposed");
      }
      try {
        validateAtlas(atlas.metadata);
        materials = createWisteriaTreeMaterials(detailed, atlas.texture, atlas.metadata, atlas.tissue);
        return materials;
      } catch (error) { releaseAtlas(atlas.texture); releaseAtlas(atlas.tissue); throw error; }
    });
    return pending;
  };
  const create = async (variant = 0, tier: WisteriaTreeTier = "near") => {
    if (disposed) throw new Error("Wisteria tree template owner is disposed");
    users++;
    try {
      const pack = await acquire();
      if (disposed) throw new Error("Wisteria tree template owner is disposed");
      const model = createWisteriaTreeModel(pack, detailed, variant, tier);
      let released = false;
      return { ...model, dispose: () => {
        if (released) return;
        released = true; model.dispose(); release();
      } };
    } catch (error) { release(); throw error; }
  };
  return { create, dispose: () => { disposed = true; },
    statistics: () => ({ users, ready: materials !== undefined, pending: !materials && pending !== undefined }) };
};

import { type ColorRepresentation, TextureLoader } from "three";

import { createPeachBlossomTreeTemplates } from "./peach-blossom-tree-templates";
import { createPeachCrownImpostorMaterial } from "./peach-crown-impostor";
import { createPeachTreeImpostorMaterial } from "./peach-tree-impostor";
import { createPeachTreeMaterials } from "./peach-tree-materials";
import type { PeachProductionMaterials } from "./peach-tree-production-model";

export type PeachAtlasSources = readonly [string, string, string];
export type PeachProductionAtlasSources = { far: PeachAtlasSources; crowns: PeachAtlasSources; flowerColour?: ColorRepresentation };

/** One async owner per quality: three original atlas textures, shared bark/leaf and canonical blossom assets. */
export const loadPeachProductionResources = async (sources: PeachAtlasSources | PeachProductionAtlasSources, detailed: boolean,
  signal?: AbortSignal, loader = new TextureLoader()) => {
  if (signal?.aborted) throw new DOMException("Peach resource request was cancelled", "AbortError");
  const urls = "far" in sources ? [...sources.far, ...sources.crowns] : sources;
  const results = await Promise.allSettled(urls.map(source => loader.loadAsync(source)));
  const textures = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const failure = results.find(result => result.status === "rejected");
  if (failure || signal?.aborted) {
    textures.forEach(texture => texture.dispose());
    if (signal?.aborted) throw new DOMException("Peach resource request was cancelled", "AbortError");
    throw new Error("Unable to load all original peach atlases", { cause: failure });
  }
  const tree = createPeachTreeMaterials(), templates = createPeachBlossomTreeTemplates(detailed, "far" in sources ? sources.flowerColour : undefined);
  const impostors = textures.slice(0, 3).map(texture => createPeachTreeImpostorMaterial(texture));
  const crowns = textures.slice(3).map(texture => createPeachCrownImpostorMaterial(texture));
  let disposed = false;
  const materialsForVariant = (variant: number): PeachProductionMaterials => {
    if (disposed) throw new Error("Peach production resources were disposed");
    const impostor = impostors[variant];
    if (!impostor) throw new Error("Unknown peach atlas variant");
    return { ...tree.materials, impostor, crowns: crowns[variant] };
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; [...impostors, ...crowns].forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose()); templates.dispose(); tree.dispose();
  };
  return { materialsForVariant, templates, get nearReady() { return !disposed && crowns.length === 3; }, dispose };
};

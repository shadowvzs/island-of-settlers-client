import { type MeshStandardMaterial, Texture, TextureLoader } from "three";

import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import { WISTERIA_PALETTES, type WisteriaRoadFrame } from "../../render-common/road-decoration-wisteria";
import { WISTERIA_PRODUCTION_ATLAS } from "../../render-common/wisteria-production-atlas-data";
import { createWisteriaBotanicalTemplates } from "./wisteria-botanical-templates";
import { createWisteriaHero } from "./wisteria-hero";
import type { WisteriaLodAtlasMetadata } from "./wisteria-lod-atlas";
import { createWisteriaMinimalTemplates } from "./wisteria-minimal-templates";
import { createWisteriaPopulationTemplates } from "./wisteria-population-templates";

type Materials = Record<BuildingSurface, MeshStandardMaterial>;
type LoadAtlas = () => Promise<Texture>;
const K_FLOWER_COLOUR = [.75, .62, .92] as const;
const metadata: WisteriaLodAtlasMetadata = {
  ...WISTERIA_PRODUCTION_ATLAS,
  raceme: { min: [...WISTERIA_PRODUCTION_ATLAS.raceme.min], max: [...WISTERIA_PRODUCTION_ATLAS.raceme.max] },
  spray: { min: [...WISTERIA_PRODUCTION_ATLAS.spray.min], max: [...WISTERIA_PRODUCTION_ATLAS.spray.max] }
};

/** One map owns the original botanical atlas; frame variants borrow it until the last release. */
export const createWisteriaProductionModels = (materials: Materials, detailed: boolean,
  loadAtlas: LoadAtlas = () => new TextureLoader().loadAsync(new URL(
    "../../../assets/botanical-textures/wisteria-owned-lod-atlas-candidate.png", import.meta.url
  ).href),
  loadNearAtlas: LoadAtlas = () => new TextureLoader().loadAsync(new URL(
    "../../../assets/botanical-textures/wisteria-neutral-atlas-candidate.png", import.meta.url
  ).href)) => {
  type Tier = "near" | "far";
  type Templates = ReturnType<typeof createWisteriaMinimalTemplates>;
  type Owner = { templates: Templates; users: number };
  const owners = new Map<Tier, Owner>(), pending = new Map<Tier, Promise<Templates>>();
  const frames = new Map<string, {
    template: ReturnType<typeof createWisteriaPopulationTemplates>; users: number;
  }>();
  const acquire = async (tier: Tier) => {
    const current = owners.get(tier);
    if (current) { current.users++; return current; }
    let request = pending.get(tier);
    if (!request) {
      request = tier === "near"
        ? loadNearAtlas().then(atlasTexture => createWisteriaBotanicalTemplates({ neutralAtlas: true, lean: true, atlasTexture }))
        : loadAtlas().then(atlas => createWisteriaMinimalTemplates(atlas, metadata));
      pending.set(tier, request);
    }
    let templates: Templates;
    try { templates = await request; }
    finally { if (pending.get(tier) === request) pending.delete(tier); }
    let owner = owners.get(tier);
    if (!owner) { owner = { templates, users: 0 }; owners.set(tier, owner); }
    owner.users++; return owner;
  };
  const release = (lease: Owner, tier: Tier) => {
    if (--lease.users > 0) return;
    lease.templates.dispose();
    if (owners.get(tier) === lease) owners.delete(tier);
  };
  const create = async (frame: WisteriaRoadFrame, palette?: keyof typeof WISTERIA_PALETTES,
    requestedTier: Tier = "far") => {
    // Minimal always borrows the cheap original-geometry bake. Full K36k stays a private study.
    const tier = detailed ? requestedTier : "far", key = `${frame}:${tier}`;
    const lease = await acquire(tier);
    try {
      let entry = frames.get(key);
      if (!entry) {
        const source = createWisteriaHero(materials, lease.templates,
          { frame, minimal: !detailed, lean: tier === "near", coarseBotany: tier === "far", flowerPalette: [1, 1, 1] });
        entry = { template: createWisteriaPopulationTemplates(source,
          mesh => ["wisteria_minimal_neutral_racemes", "wisteria_open_petals", "wisteria_closed_buds"].includes(mesh.name)), users: 0 };
        frames.set(key, entry);
      }
      const borrowed = entry;
      borrowed.users++;
      const template = borrowed.template.createTemplate();
      let disposed = false;
      return { root: template.root, triangles: borrowed.template.triangles,
        flowerColour: palette ? WISTERIA_PALETTES[palette] : K_FLOWER_COLOUR,
        dispose: () => {
          if (disposed) return;
          disposed = true; template.dispose();
          if (--borrowed.users === 0) { borrowed.template.dispose(); frames.delete(key); }
          release(lease, tier);
        } };
    } catch (error) { release(lease, tier); throw error; }
  };
  return { create };
};

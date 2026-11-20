import { getRoadDecorationItem } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { OrnamentalPlantTier } from "../../../../island-of-settlers-shared/src/road-plant-models";
import type { DecorationFoliageSource } from "./plants/decoration-foliage-source";
import { createDecorationAssetLoader, type DecorationAssetLoader, type DecorationMaterialsFor,
  type RoadDecorationTemplate } from "./road-decoration-asset-loader";

interface Entry {
  template?: RoadDecorationTemplate;
  pending?: Promise<RoadDecorationTemplate | undefined>;
  error?: unknown;
  retryAt: number;
}

/** Adapts a freshly loaded template before it is cached (D08 wind sway); returns the template to keep. */
export type PrepareDecorationTemplate = (template: RoadDecorationTemplate, id: string,
  tier: OrnamentalPlantTier) => RoadDecorationTemplate;

interface TemplateOptions {
  foliage?: DecorationFoliageSource;
  idleLimit?: number;
  prepare?: PrepareDecorationTemplate;
}

/** One map/LOD owns its assets. Inactive templates use a bounded LRU; borrowed national maps stay borrowed. */
export const createRoadDecorationTemplates = (materialsFor: DecorationMaterialsFor, detailed: boolean,
  load?: DecorationAssetLoader, { foliage, idleLimit = 8, prepare }: TemplateOptions = {}) => {
  let acquireMaterials: DecorationMaterialsFor | undefined = materialsFor;
  const loadAsset = load ?? createDecorationAssetLoader(nation => {
    if (!acquireMaterials) throw new Error("Decoration material owner is disposed");
    return acquireMaterials(nation);
  }, detailed, foliage);
  const structures = new Map<string, Entry>();
  let wanted = new Set<string>(), disposed = false;
  const keyFor = (id: string, tier: OrnamentalPlantTier = "near") => {
    const sku = getRoadDecorationItem(id);
    if (!sku) throw new Error(`Unknown decoration item: ${id}`);
    const asset = sku.plant;
    // The requested representation is part of identity for every model, including future families.
    // A family whitelist can silently return cached near geometry for a newly introduced far tier.
    const suffix = tier !== "near" ? `:${tier}` : "";
    const palette = asset && asset.palette !== "default" ? `:${asset.palette}` : "";
    return asset ? `plant:${asset.species}:${asset.form}:${asset.variant}:${asset.potted}${palette}${suffix}` : `${id}${suffix}`;
  };
  const trim = () => {
    const idle = [...structures].filter(([key, entry]) => !wanted.has(key) && entry.template);
    for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - idleLimit))) {
      entry.template?.dispose(); structures.delete(key);
    }
  };
  const retainKeys = (keys: Iterable<string>) => {
    wanted = new Set(keys);
    for (const [key, entry] of structures) {
      // Invalidate obsolete pending requests. A later request for the same key gets a fresh owner.
      if (!wanted.has(key) && !entry.template) structures.delete(key);
    }
    for (const key of wanted) {
      const entry = structures.get(key);
      if (entry) { structures.delete(key); structures.set(key, entry); }
    }
    trim();
  };
  const retain = (ids: Iterable<string>) => retainKeys(Array.from(ids, id => keyFor(id)));
  const retainLods = (entries: Iterable<{ item: string; tier: OrnamentalPlantTier }>) =>
    retainKeys(Array.from(entries, entry => keyFor(entry.item, entry.tier)));
  const peek = (id: string, tier: OrnamentalPlantTier = "near") => structures.get(keyFor(id, tier))?.template;
  const get = (id: string, tier: OrnamentalPlantTier = "near") => {
    const template = peek(id, tier);
    if (!template) throw new Error(`Decoration asset is not loaded: ${id}`);
    return template;
  };
  const request = (id: string, retry = false, tier: OrnamentalPlantTier = "near"):
  Promise<RoadDecorationTemplate | undefined> => {
    if (disposed) return Promise.resolve(undefined);
    const key = keyFor(id, tier);
    let entry = structures.get(key);
    if (entry?.template) {
      structures.delete(key); structures.set(key, entry);
      return Promise.resolve(entry.template);
    }
    if (entry?.pending) return entry.pending;
    if (entry?.error && !retry && Date.now() < entry.retryAt) return Promise.resolve(undefined);
    entry = { retryAt: 0 }; structures.set(key, entry);
    const owner = entry;
    const active = () => !disposed && structures.get(key) === owner && wanted.has(key);
    owner.pending = Promise.resolve().then(() => loadAsset(id, key, active, tier)).then(loaded => {
      if (!active()) { loaded?.dispose(); return undefined; }
      const template = loaded && prepare ? prepare(loaded, id, tier) : loaded;
      owner.pending = undefined; owner.template = template;
      trim(); return template;
    }, error => {
      if (structures.get(key) === owner) {
        owner.pending = undefined; owner.error = error; owner.retryAt = Date.now() + 1000;
      }
      return undefined;
    });
    return owner.pending;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; acquireMaterials = undefined;
    for (const entry of structures.values()) entry.template?.dispose();
    structures.clear(); wanted.clear();
  };
  return { dispose, get, keyFor, peek, request, retain, retainLods,
    hasErrors: () => {
      for (const entry of structures.values()) if (entry.error && Date.now() >= entry.retryAt) return true;
      return false;
    },
    ready: () => Promise.all([...structures.values()].flatMap(entry => entry.pending ? [entry.pending] : [])),
    statistics: () => ({ templates: [...structures.values()].filter(entry => entry.template).length,
      pending: [...structures.values()].filter(entry => entry.pending).length,
      errors: [...structures.values()].filter(entry => entry.error).length }) };
};

import type { ThreeWorkerPack } from "@workers/game-three-worker";
import { type AnimationClip, Mesh, type Object3D, Texture } from "three";

type LoadedWorker = Awaited<ReturnType<ThreeWorkerPack["load"]>>;

/**
 * The two caches `ThreeWorkerPack` shares between every body, armour piece and prop. The pack
 * exposes no per-entry release API, so the crowd keeps their ownership here: one reference per
 * live body type or prop, and an entry leaves the pack cache with its last reference.
 */
interface WorkerPackCacheView {
  clips?: Map<string, Promise<AnimationClip[]>>;
  textures?: Map<string, Texture>;
}

interface HeldAssets {
  clips: Set<string>;
  textures: Set<Texture>;
}

export interface WorkerPackAssetStats {
  clips: number;
  holders: number;
  pending: number;
  textures: number;
}

export type WorkerPackAssets = ReturnType<typeof createWorkerPackAssets>;

/**
 * Per-type ownership of the shared worker-pack texture and clip caches. A body load keeps the
 * entries it uses while the load is pending; the last body type (or held prop) using an entry
 * releases it to the pack. Entries left behind by a failed or discarded generation are trimmed
 * once the last pending load settles, and a late load cannot repopulate them.
 */
export const createWorkerPackAssets = (pack: ThreeWorkerPack) => {
  const caches = pack as unknown as WorkerPackCacheView;
  const clipCache = caches.clips instanceof Map ? caches.clips : undefined;
  const textureCache = caches.textures instanceof Map ? caches.textures : undefined;
  const holders = new Map<object, HeldAssets>();
  const clipRefs = new Map<string, number>();
  const textureRefs = new Map<Texture, number>();
  const disposedTextures = new WeakSet<Texture>();
  let pending = 0;
  let disposed = false;

  /** Every texture a mesh's material slots hold; armour pieces and props are roots too. */
  const texturesOf = (root: Object3D) => {
    const textures = new Set<Texture>();
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials)
        for (const value of Object.values(material))
          if (value instanceof Texture) textures.add(value);
    });
    return textures;
  };

  /** The clip cache keys the pack used for this body (common clips plus its override). */
  const clipPathsOf = (source: LoadedWorker) => {
    const paths = new Set<string>();
    const entry = source.entry as
      { animationOverrides?: string | null; animations?: string } | undefined;
    if (entry?.animations && clipCache?.has(entry.animations)) paths.add(entry.animations);
    if (entry?.animationOverrides && clipCache?.has(entry.animationOverrides))
      paths.add(entry.animationOverrides);
    return paths;
  };

  const removeTexture = (texture: Texture) => {
    if (textureCache)
      for (const [key, cached] of textureCache) if (cached === texture) textureCache.delete(key);
    textureRefs.delete(texture);
    if (disposedTextures.has(texture)) return;
    disposedTextures.add(texture);
    texture.dispose();
  };

  const removeClip = (path: string) => {
    clipCache?.delete(path);
    clipRefs.delete(path);
  };

  /** Drop every cache entry no live holder owns. Pending loads keep their entries untouched. */
  const flush = () => {
    if (disposed || pending) return;
    for (const [texture, refs] of textureRefs) if (refs === 0) removeTexture(texture);
    for (const [path, refs] of clipRefs) if (refs === 0) removeClip(path);
    if (textureCache) {
      const unreferenced = new Set<Texture>();
      for (const texture of textureCache.values())
        if (!textureRefs.has(texture)) unreferenced.add(texture);
      for (const texture of unreferenced) removeTexture(texture);
    }
    if (clipCache)
      for (const path of clipCache.keys()) if (!clipRefs.has(path)) clipCache.delete(path);
  };

  const hold = (holder: object, assets: HeldAssets) => {
    holders.set(holder, assets);
    for (const texture of assets.textures) textureRefs.set(texture, (textureRefs.get(texture) ?? 0) + 1);
    for (const path of assets.clips) clipRefs.set(path, (clipRefs.get(path) ?? 0) + 1);
  };

  /** A late holder after disposal owns nothing: release its textures and cache entries now. */
  const trim = (assets: HeldAssets) => {
    for (const texture of assets.textures)
      if (!textureRefs.get(texture)) removeTexture(texture);
    for (const path of assets.clips) if (!clipRefs.get(path)) removeClip(path);
  };

  const releaseHolder = (holder: object) => {
    const assets = holders.get(holder);
    if (!assets) return;
    holders.delete(holder);
    for (const texture of assets.textures) {
      const refs = (textureRefs.get(texture) ?? 0) - 1;
      if (refs > 0) textureRefs.set(texture, refs); else textureRefs.set(texture, 0);
    }
    for (const path of assets.clips) {
      const refs = (clipRefs.get(path) ?? 0) - 1;
      if (refs > 0) clipRefs.set(path, refs); else clipRefs.set(path, 0);
    }
    flush();
  };

  return {
    /** Protects cache entries touched by an in-flight body/prop load until it settles. */
    beginLoad: () => {
      if (disposed) return () => {};
      pending++;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        if (disposed) return;
        pending--;
        // A failed load can leave entries nobody held; a successful one retained them all.
        if (!pending) flush();
      };
    },
    /** Takes shared ownership of the textures and clips one loaded body type uses. */
    retainBody: (source: LoadedWorker) => {
      if (holders.has(source)) return;
      const assets = { clips: clipPathsOf(source), textures: texturesOf(source.root) };
      if (disposed) trim(assets); else hold(source, assets);
    },
    /** Drops one body type; the last instance of the last type releases its shared entries. */
    releaseBody: (source: LoadedWorker) => releaseHolder(source),
    /**
     * Takes shared ownership of a prop/armour scene loaded through the same pack. The returned
     * release is stored on the prop and called by its normal disposal.
     */
    retainProp: (root: Object3D) => {
      const assets: HeldAssets = { clips: new Set(), textures: texturesOf(root) };
      if (disposed) { trim(assets); return () => {}; }
      hold(root, assets);
      let released = false;
      return () => {
        if (released) return;
        released = true; releaseHolder(root);
      };
    },
    stats: (): WorkerPackAssetStats => ({
      clips: clipCache?.size ?? 0,
      holders: holders.size,
      pending,
      textures: textureCache?.size ?? 0
    }),
    /** Invalidate late loads and release every shared entry still cached by the pack. */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      holders.clear(); clipRefs.clear(); textureRefs.clear(); pending = 0;
      clipCache?.clear();
      if (textureCache) {
        const textures = new Set(textureCache.values());
        textureCache.clear();
        for (const texture of textures) removeTexture(texture);
      }
    }
  };
};

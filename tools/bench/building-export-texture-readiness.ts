import { type Mesh, type MeshStandardMaterial, type Object3D, type Texture, TextureLoader } from "three";

const slots = ["map", "alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap",
  "lightMap", "metalnessMap", "normalMap", "roughnessMap"] as const;
const hasImage = (texture: Texture) => {
  const image = texture.image as { width?: number; height?: number } | null;
  return Boolean(image && Number(image.width) > 0 && Number(image.height) > 0);
};

/** Export-only load promises; failed/disposed images remain errors, never replacement textures. */
export const trackBuildingExportTextureLoads = () => {
  const load = TextureLoader.prototype.load;
  const loads = new Map<Texture, { url: string; ready: Promise<void> }>();
  TextureLoader.prototype.load = function (...args: Parameters<typeof load>) {
    const [url, onLoad, onProgress, onError] = args;
    let done!: () => void, fail!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
    // A load can fail before export reaches parseAsync; preserve that rejection for the real await.
    void ready.catch(() => undefined);
    const texture = load.call(this, url, loaded => {
      try {
        onLoad?.(loaded);
        if (!hasImage(loaded)) throw new Error(`Loaded building export image was cleared/disposed: ${url}`);
        done();
      } catch (error) { fail(error); }
    }, onProgress, error => {
      try { onError?.(error); }
      finally { fail(new Error(`Building export texture failed to load: ${url}`, { cause: error })); }
    });
    loads.set(texture, { url, ready });
    return texture;
  };
  const wait = async (input: Object3D | Object3D[]) => {
    const missing = new Set<Texture>();
    for (const root of Array.isArray(input) ? input : [input]) root.traverse(object => {
      if (!(object as Mesh).isMesh) return;
      const material = (object as Mesh).material;
      for (const entry of Array.isArray(material) ? material : [material]) for (const slot of slots) {
        const texture = (entry as MeshStandardMaterial)[slot];
        if (texture && !hasImage(texture)) missing.add(texture);
      }
    });
    await Promise.all([...missing].map(texture => {
      const pending = loads.get(texture);
      if (!pending) throw new Error(`Building export image has no tracked load (missing/disposed): ${texture.uuid}`);
      return pending.ready;
    }));
    for (const texture of missing) if (!hasImage(texture))
      throw new Error(`Building export texture remained missing after its real load: ${loads.get(texture)!.url}`);
  };
  return { wait, restore: () => { TextureLoader.prototype.load = load; loads.clear(); } };
};

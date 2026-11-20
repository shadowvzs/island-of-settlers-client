import { MeshStandardMaterial, SRGBColorSpace, Texture, TextureLoader } from "three";

const faceURL = new URL("../../../../assets/ware-icons/coins.png", import.meta.url).href;
interface Entry { material: MeshStandardMaterial; texture: Texture; references: number }
const cache = new WeakMap<MeshStandardMaterial, Map<boolean, Entry>>();
const clearImage = (texture: Texture) => {
  (texture.image as { close?: () => void } | null)?.close?.(); texture.image = null;
};

/** Reuses the actual single-coin icon face; all live stock/carry coins share one material per source/LOD. */
export const acquireCoinFaceMaterial = (source: MeshStandardMaterial, detailed: boolean) => {
  let levels = cache.get(source);
  if (!levels) { levels = new Map(); cache.set(source, levels); }
  let entry = levels.get(detailed);
  if (!entry) {
    // Headless verifier/model-bound tests never decode bitmap assets or own a WebGL context.
    const texture = typeof document === "undefined" ? new Texture() : new TextureLoader().load(faceURL, loaded => {
      if (entry?.references !== 0) return;
      clearImage(loaded);
    });
    texture.colorSpace = SRGBColorSpace;
    // The 192² authored icon contains a single face at x24..168/y26..165; exclude its transparent
    // framing/shadow instead of stamping the entire icon rectangle onto a small physical disc.
    texture.offset.set(24 / 192, 27 / 192); texture.repeat.set(144 / 192, 139 / 192);
    const material = new MeshStandardMaterial({ alphaTest: .08, color: "#ffffff", map: texture,
      metalness: .45, roughness: .42, vertexColors: true });
    entry = { material, texture, references: 0 }; levels.set(detailed, entry);
  }
  entry.references++;
  let released = false;
  return { material: entry.material, release: () => {
    if (released) return;
    released = true;
    if (--entry.references !== 0) return;
    levels.delete(detailed); entry.material.dispose(); entry.texture.dispose();
    clearImage(entry.texture);
  } };
};

import { LinearFilter, LinearMipmapLinearFilter, type MeshStandardMaterial, RepeatWrapping, SRGBColorSpace,
type Texture,  TextureLoader } from "three";

const high = new URL("../../../../assets/textures/roads/compacted-earth-high.webp", import.meta.url).href;
const minimal = new URL("../../../../assets/textures/roads/compacted-earth-minimal.webp", import.meta.url).href;
const relief = new URL("../../../../assets/textures/roads/compacted-earth-relief.webp", import.meta.url).href;

/** Original soil image replaces the baked fallback after loading, without an extra material pass. */
export const loadRoadSoilMaterial = (material: MeshStandardMaterial, detailed: boolean) => {
  if (typeof document === "undefined") return;
  let disposed = false;
  material.addEventListener("dispose", () => { disposed = true; });
  const loader = new TextureLoader();
  const load = (url: string, color: boolean, apply: (texture: Texture) => void) => {
    loader.load(url, texture => {
      if (disposed) { texture.dispose(); return; }
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      if (color) texture.colorSpace = SRGBColorSpace;
      apply(texture);
      material.needsUpdate = true;
    });
  };
  load(detailed ? high : minimal, true, texture => {
    material.map?.dispose(); material.map = texture;
  });
  if (detailed) load(relief, false, texture => {
    material.bumpMap?.dispose(); material.bumpMap = texture; material.bumpScale = .018;
  });
};

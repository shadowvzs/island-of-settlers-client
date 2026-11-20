import {
  type BufferGeometry, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter,
  SRGBColorSpace, type Texture, TextureLoader
} from "three";

export type WisteriaAtlasSurface = "leafFront" | "leafBack" | "banner" | "wing" | "keel" | "bud";
type Rectangle = readonly [number, number, number, number];
const SIZE = 1254;
/** Tight tissue bounds in the original neutral artwork; pixel coordinates start at the top left. */
export const WISTERIA_ATLAS_REGIONS: Readonly<Record<WisteriaAtlasSurface, Rectangle>> = {
  leafFront: [185, 5, 453, 454], leafBack: [808, 7, 1068, 455],
  banner: [29, 460, 600, 865], wing: [744, 457, 1140, 859],
  keel: [178, 877, 443, 1241], bud: [633, 914, 1230, 1224]
};

/** Tissue-local u/v uses the same upward-v convention as Three geometry. */
export const wisteriaAtlasUV = (surface: WisteriaAtlasSurface, u: number, v: number) => {
  const [left, top, right, bottom] = WISTERIA_ATLAS_REGIONS[surface];
  return [(left + u * (right - left)) / SIZE, 1 - (bottom - v * (bottom - top)) / SIZE] as const;
};

/** Modifies only an owner's canonical template, never the geometry of each placed flower. */
export const mapWisteriaAtlasVertices = (geometry: BufferGeometry, surface: WisteriaAtlasSurface,
  first: number, count: number, localUV: (vertex: number) => readonly [number, number]) => {
  const uv = geometry.getAttribute("uv");
  if (first < 0 || count < 0 || first + count > uv.count) throw new Error("Invalid Wisteria atlas vertex range");
  for (let vertex = first; vertex < first + count; vertex++) {
    const local = localUV(vertex), mapped = wisteriaAtlasUV(surface, local[0], local[1]);
    uv.setXY(vertex, mapped[0], mapped[1]);
  }
  uv.needsUpdate = true;
};

type RequestTexture = (url: string, ready: (texture: Texture) => void,
  failed: () => void) => Texture;

/** One original neutral bitmap belongs to the shared botanical-template owner, not its instances. */
export const createWisteriaBotanicalAtlas = (request?: RequestTexture) => {
  const loader = request ?? ((url, ready, failed) => new TextureLoader().load(url, ready, undefined, failed));
  let disposed = false, ready = false, failed = false, released = false;
  const release = (texture: Texture) => {
    texture.image = null;
    if (released) return;
    released = true;
    texture.dispose();
  };
  const texture = loader(new URL("../../../assets/botanical-textures/wisteria-neutral-atlas-candidate.png",
    import.meta.url).href, loaded => {
    if (disposed) { release(loaded); return; }
    ready = true;
  }, () => { if (!disposed) failed = true; });
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return { texture, state: () => ({ ready, failed, disposed }), dispose: () => {
    if (disposed) return;
    disposed = true;
    release(texture);
  } };
};

import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, RepeatWrapping,
  SRGBColorSpace, Texture, TextureLoader } from "three";

import { ADVANCED_MATERIAL_SOURCE_DATA } from "../../../render-common/wares/advanced-material-source-data";
import { stoneWareAppearance, woodWareAppearance } from "../../../render-common/wares/advanced-material-variants";
import { applyStoneMaterialDetail } from "./stone-material-detail";

export type AdvancedAssetKind = keyof typeof ADVANCED_MATERIAL_SOURCE_DATA;
export interface AdvancedAssetChunk {
  material: number; position: number[]; uv: number[]; minimalPosition?: number[]; minimalUv?: number[];
}
const urls = import.meta.glob<string>("../../../../assets/models/materials/*.png", {
  eager: true, import: "default", query: "?url"
});
const textures = new Map<string, { texture: Texture; ready: Promise<void>; refs: number }>();
/** Without a DOM (headless geometry checks) the image cannot decode; an empty texture keeps materials valid. */
const loadTexture = (url: string) => {
  if (typeof document === "undefined") return { texture: new Texture(), ready: Promise.resolve() };
  let resolve!: () => void, reject!: (reason: unknown) => void;
  const ready = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { texture: new TextureLoader().load(url, () => resolve(), undefined, reject), ready };
};
const acquireTexture = (name: string) => {
  let entry = textures.get(name);
  if (!entry) {
    const url = urls[`../../../../assets/models/materials/${name}`];
    if (!url) throw new Error(`Missing approved material texture: ${name}`);
    const { ready, texture } = loadTexture(url);
    texture.colorSpace = SRGBColorSpace; texture.flipY = false;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    entry = { texture, ready, refs: 0 }; textures.set(name, entry);
    // The renderer's readiness path can await failures; avoid an unhandled rejection before then.
    void ready.catch(() => undefined);
  }
  entry.refs++;
  return entry.texture;
};
const packs = new Map<string, { refs: number; materials: MeshStandardMaterial[]; textures: string[] }>();
export const acquireAdvancedMaterials = (kind: AdvancedAssetKind, detailed: boolean, variant = "") => {
  const key = `${kind}:${detailed}:${variant}`;
  const appearance = woodWareAppearance(variant) ?? stoneWareAppearance(variant);
  let pack = packs.get(key);
  if (!pack) {
    const names: string[] = [];
    const materials = ADVANCED_MATERIAL_SOURCE_DATA[kind].materials.map((source, index) => {
      names.push(source.texture);
      const material = new MeshStandardMaterial({ map: acquireTexture(source.texture),
        roughness: source.roughness, metalness: 0 });
      const wood = woodWareAppearance(variant), stone = stoneWareAppearance(variant);
      const tint = appearance && (!wood || index < (kind === "logs" ? 2 : 1)) ? appearance.tint : [1, 1, 1];
      material.color.setRGB(source.color[0]! * tint[0]!, source.color[1]! * tint[1]!, source.color[2]! * tint[2]!);
      if (stone) material.roughness = stone.roughness;
      if (wood?.roughness !== undefined && index < (kind === "logs" ? 2 : 1))
        material.roughness = wood.roughness;
      if (stone) applyStoneMaterialDetail(material, variant, detailed);
      return material;
    });
    pack = { refs: 0, materials, textures: names }; packs.set(key, pack);
  }
  pack.refs++; let released = false;
  return { materials: pack.materials, release: () => {
    if (released) return; released = true;
    if (--pack!.refs > 0) return;
    pack!.materials.forEach(material => material.dispose());
    for (const name of pack!.textures) {
      const entry = textures.get(name)!;
      if (--entry.refs === 0) { entry.texture.dispose(); textures.delete(name); }
    }
    packs.delete(key);
  } };
};
export const waitForAdvancedMaterialTextures = () => Promise.all([...textures.values()].map(entry => entry.ready));

/** Unindexed source pieces merge into one draw per material, with flat angular fracture normals. */
export const advancedAssetGeometry = (chunks: readonly AdvancedAssetChunk[], detailed: boolean,
  transform: (x: number, y: number, z: number) => number[]) => {
  const position: number[] = [], uv: number[] = [];
  for (const chunk of chunks) {
    const values = detailed || !chunk.minimalPosition ? chunk.position : chunk.minimalPosition;
    const coordinates = detailed || !chunk.minimalUv ? chunk.uv : chunk.minimalUv;
    for (let at = 0; at < values.length; at += 9) {
      const a = transform(values[at]!, values[at + 1]!, values[at + 2]!);
      const b = transform(values[at + 3]!, values[at + 4]!, values[at + 5]!);
      const c = transform(values[at + 6]!, values[at + 7]!, values[at + 8]!);
      const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
      const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) continue;
      position.push(...a, ...b, ...c); uv.push(...coordinates.slice(at / 3 * 2, at / 3 * 2 + 6));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

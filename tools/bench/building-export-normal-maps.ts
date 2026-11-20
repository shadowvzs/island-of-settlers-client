import { CanvasTexture, DataTexture, type Material, Mesh, MeshStandardMaterial, type Object3D,
  RGBAFormat, Source, type Texture, UnsignedByteType } from "three";
import { GLTFExporter, type GLTFExporterOptions } from "three/addons/exporters/GLTFExporter.js";

import { prepareBuildingExportAnimationTargets } from "./building-export-animation-targets";
import { trackBuildingExportTextureLoads } from "./building-export-texture-readiness";

const materialTextureSlots = ["map", "alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap",
  "lightMap", "metalnessMap", "normalMap", "roughnessMap"] as const;

/** Small metadata only; a null/disposed/pending texture is never silently replaced or omitted. */
export const invalidBuildingExportTextures = (input: Object3D | Object3D[]) => {
  const rows: Record<string, unknown>[] = [];
  for (const root of Array.isArray(input) ? input : [input]) root.traverse(object => {
    if (!(object as Mesh).isMesh) return;
    const mesh = object as Mesh;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      for (const slot of materialTextureSlots) {
        const texture = (material as MeshStandardMaterial)[slot];
        if (!texture) continue;
        const image = texture.image as { constructor?: { name: string }; width?: number; height?: number;
          data?: { length: number }; src?: string } | null;
        if (image && image.width && image.height) continue;
        let owner: Object3D | null = mesh;
        while (owner?.parent && owner.userData.buildingId === undefined) owner = owner.parent;
        rows.push({ mesh: mesh.name, buildingId: owner?.userData.buildingId, nation: owner?.userData.nation,
          material: material.name, slot, texture: texture.uuid, format: texture.format, type: texture.type,
          dataTexture: Boolean((texture as DataTexture).isDataTexture), imageConstructor: image?.constructor?.name ?? null,
          width: image?.width ?? null, height: image?.height ?? null, dataLength: image?.data?.length ?? null,
          source: image?.src ?? null });
      }
  });
  return rows;
};

/** GLTFExporter's normal conversion and metal/rough merge need CanvasImageSource images. */
export const exportNormalMapPixels = (texture: DataTexture) => {
  const { data, height, width } = texture.image;
  if (texture.type !== UnsignedByteType || texture.format !== RGBAFormat ||
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4)
    throw new Error(`Unsupported raw export normal map: ${texture.name || texture.uuid}`);
  return { data: new Uint8ClampedArray(data), height, width };
};

const createCanvasNormalMap = (texture: DataTexture): Texture => {
  const { data, height, width } = exportNormalMapPixels(texture);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Normal-map export requires a 2D canvas context");
  context.putImageData(new ImageData(data, width, height), 0, 0);
  const result: Texture = new CanvasTexture(canvas);
  result.copy(texture);
  // Texture.copy shares Source; replace it rather than changing the runtime DataTexture's image.
  result.source = new Source(canvas); result.needsUpdate = true;
  return result;
};

/** Only temporary export meshes/materials change; all original references survive success/failure. */
export const prepareBuildingExportNormalMaps = (input: Object3D | Object3D[],
  createTexture: (texture: DataTexture) => Texture = createCanvasNormalMap) => {
  const materials = new Map<Material, Material>(), textures = new Map<Texture, Texture>();
  const changed: { mesh: Mesh; material: Material | Material[] }[] = [];
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const { material, mesh } of changed) mesh.material = material;
    for (const material of materials.values()) material.dispose();
    for (const texture of textures.values()) texture.dispose();
  };
  const prepareMaterial = (material: Material) => {
    const standard = material as MeshStandardMaterial;
    const slots = (["normalMap", "roughnessMap", "metalnessMap"] as const)
      .filter(slot => (standard[slot] as DataTexture | null | undefined)?.isDataTexture);
    if (!slots.length) return material;
    const known = materials.get(material);
    if (known) return known;
    const clone = material.clone() as MeshStandardMaterial;
    materials.set(material, clone);
    for (const slot of slots) {
      const raw = standard[slot] as DataTexture;
      let texture = textures.get(raw);
      if (!texture) { texture = createTexture(raw); textures.set(raw, texture); }
      clone[slot] = texture;
    }
    return clone;
  };
  try {
    for (const root of Array.isArray(input) ? input : [input]) root.traverse(object => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh, original = mesh.material;
      const prepared = Array.isArray(original) ? original.map(prepareMaterial) : prepareMaterial(original);
      const modified = Array.isArray(original)
        ? original.some((material, index) => material !== (prepared as Material[])[index]) : prepared !== original;
      if (!modified) return;
      changed.push({ material: original, mesh }); mesh.material = prepared;
    });
  } catch (error) { restore(); throw error; }
  return { convertedMaterials: materials.size, convertedTextures: textures.size, restore };
};

/** The showcase owns its exporter privately; scope this export-only bridge to one serial operation. */
export const withBuildingExportNormalMaps = async <T>(operation: () => Promise<T>) => {
  const parse = GLTFExporter.prototype.parseAsync;
  const textureLoads = trackBuildingExportTextureLoads();
  let calls = 0;
  GLTFExporter.prototype.parseAsync = async function(this: GLTFExporter, input: Object3D | Object3D[],
    options?: GLTFExporterOptions) {
    calls++;
    await textureLoads.wait(input);
    const prepared = prepareBuildingExportNormalMaps(input);
    let anchors: ReturnType<typeof prepareBuildingExportAnimationTargets> | undefined;
    try {
      anchors = prepareBuildingExportAnimationTargets(input, options?.animations?.flat());
      return await parse.call(this, input, { ...options, animations: anchors.animations });
    }
    catch (error) {
      throw new Error(`${String(error)}\nInvalid building export texture metadata: ${JSON.stringify(invalidBuildingExportTextures(input))}`,
        { cause: error });
    }
    finally { anchors?.restore(); prepared.restore(); }
  };
  try {
    const result = await operation();
    if (!calls) throw new Error("Building export did not use the guarded GLTFExporter instance");
    return result;
  } finally { GLTFExporter.prototype.parseAsync = parse; textureLoads.restore(); }
};

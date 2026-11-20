import { type BufferGeometry, Group, type IUniform, type Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { MONUMENT_ASSETS, monumentRecipe } from "../../../render-common/buildings/monument-definition";
import { isBuildingFirstNation, type SettlerNation, type WorkerNation } from "../../../render-common/workers/worker-nation";
import { createOwnedAssetCache } from "../owned-asset-cache";
import { meshMaterials } from "../three-mesh-resources";
import { connectSunShadowReceivers } from "./building-shadows";
import { finishJapaneseMonumentFloor } from "./japanese-monument-floor";
import { finishMonumentArchitecture } from "./monument-owner-finish";
import type { createRomanBuilding } from "./roman-building";
import { windowShadowMaterial } from "./window-shadow-material";

const constructionCasters = new WeakMap<Group, MeshBasicMaterial>();
export const monumentShadowMaterial = (root: Group) => constructionCasters.get(root);

const urls = {
  roman: [new URL("../../../../assets/monuments/roman-high.glb", import.meta.url).href,
    new URL("../../../../assets/monuments/roman-minimal.glb", import.meta.url).href],
  viking: [new URL("../../../../assets/monuments/viking-high.glb", import.meta.url).href,
    new URL("../../../../assets/monuments/viking-minimal.glb", import.meta.url).href],
  nubian: [new URL("../../../../assets/monuments/nubian-high.glb", import.meta.url).href,
    new URL("../../../../assets/monuments/nubian-minimal.glb", import.meta.url).href],
  japanese: [new URL("../../../../assets/monuments/japanese-continuous-high.glb", import.meta.url).href,
    new URL("../../../../assets/monuments/japanese-continuous-minimal.glb", import.meta.url).href]
} as const;
const disposeSource = (root: Group) => {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of meshMaterials(object)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value && typeof value === "object" && "isTexture" in value)
        textures.add(value as Texture);
    }
  });
  const images = new Set<unknown>();
  for (const texture of textures) { images.add(texture.source.data); texture.dispose(); }
  for (const image of images) if (image && typeof image === "object" && "close" in image && typeof image.close === "function")
    image.close();
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
};
/** Geometry/textures are shared while a real building, cursor, showcase or preview holds a lease. */
const sources = createOwnedAssetCache(async url => (await new GLTFLoader().loadAsync(url)).scene, disposeSource);
export const monumentAssetStats = () => sources.stats();
export const retainMonumentAsset = (nation: SettlerNation, detailed: boolean) =>
  sources.acquire(urls[nation][detailed ? 0 : 1]);
export const buildingAssetReady = (root: Group): Promise<void> => root.userData.assetReady ?? Promise.resolve();

/** Static supplied national monument; its decorative doors do not invent an interior worker/effect. */
export const createMonumentBuilding = (nation: SettlerNation, detailed: boolean, floorMaterial?: MeshStandardMaterial) => {
  const root = new Group(); root.name = `${nation}_63`;
  Object.assign(root.userData, { nation, monument: true, assetStatus: "pending", upAxis: [0, 1, 0],
    gridPlacement: { scale: 1 }, authoredHeight: MONUMENT_ASSETS[nation].height });
  const lease = retainMonumentAsset(nation, detailed);
  let disposed = false, building: Group | undefined, construction = 1;
  const ownedGeometry: BufferGeometry[] = [];
  const height = { value: Infinity };
  const extend: MeshStandardMaterial["onBeforeCompile"] = shader => {
    shader.uniforms.monumentConstructionHeight = height;
    shader.vertexShader = `varying float monumentConstructionY;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>", "#include <project_vertex>\nmonumentConstructionY = (modelMatrix * vec4(transformed, 1.0)).y;");
    shader.fragmentShader = `uniform float monumentConstructionHeight;\nvarying float monumentConstructionY;\n${shader.fragmentShader}`.replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\nif (monumentConstructionY > monumentConstructionHeight) discard;");
  };
  const prepareMaterial = (material: Material) => {
    material.onBeforeCompile = extend;
    material.userData.extendShader = extend; material.userData.shaderKey = "monument-construction-v1";
    // The WebGPU TSL twin clips at the same height (a plain reference, ignored by WebGL).
    material.userData.constructionHeight = height;
    material.customProgramCacheKey = () => "monument-construction-v1";
    return material;
  };
  const casterMaterial = new MeshBasicMaterial(); prepareMaterial(casterMaterial);
  constructionCasters.set(root, casterMaterial);
  const update: ReturnType<typeof createRomanBuilding>["update"] = (_time, frame) => {
    construction = frame.construction;
    height.value = construction >= 1 ? Infinity : root.position.y + MONUMENT_ASSETS[nation].height * construction;
    if (building) building.visible = construction > 0;
  };
  const ready = lease.promise.then(source => {
    if (disposed) return;
    building = source.clone(true);
    ownedGeometry.push(...finishMonumentArchitecture(building, nation));
    if (nation === "japanese" && floorMaterial) ownedGeometry.push(...finishJapaneseMonumentFloor(building, floorMaterial));
    // Preserve foreign authoring metadata without duplicating the game's top-level nation/model identity.
    building.userData = { authored: building.userData };
    const clones = new Map<Material, Material>();
    building.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const copy = (material: Material) => {
        let result = clones.get(material);
        if (!result) { const visual = object.userData.openingShadow && material instanceof MeshStandardMaterial
            ? windowShadowMaterial(material) : material;
          result = prepareMaterial(visual.clone());
          // The supplied oak normal map has deep cellular noise. Door leaves need shallow
          // longitudinal wood relief; retain their original colour, grain, UVs and solid opacity.
          if (nation === "roman" && /^DoorMain[LR]oak$/.test(object.name.replace(/[._]/g, "")) &&
            result instanceof MeshStandardMaterial) result.normalScale.multiplyScalar(.2);
          clones.set(material, result); }
        return result;
      };
      object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material);
      object.userData.ownedMaterial = true;
      object.castShadow = detailed && !object.userData.openingShadow;
      object.receiveShadow = !object.userData.openingShadow;
    });
    root.add(building); building.visible = construction > 0;
    root.userData.assetStatus = "ready";
    return undefined;
  }).catch(error => { if (!disposed) { root.userData.assetStatus = "failed"; throw error; } });
  root.userData.assetReady = ready;
  void ready.catch(() => { /* The renderer/showcase awaits and reports asset readiness. */ });
  const dispose = () => {
    if (disposed) return;
    disposed = true; root.userData.disposed = true; casterMaterial.dispose(); constructionCasters.delete(root);
    const materials = new Set<Material>();
    root.traverse(object => { if (object instanceof Mesh) meshMaterials(object).forEach(material => materials.add(material)); });
    materials.forEach(material => material.dispose()); ownedGeometry.forEach(geometry => geometry.dispose());
    root.clear(); lease.release();
  };
  const triangles = () => {
    let count = 0;
    root.traverse(object => { if (object instanceof Mesh)
      count += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3; });
    return count;
  };
  return { root, update, dispose, triangles, recipe: monumentRecipe(), fitToGrid: () => root.scale.setScalar(1) };
};

/** One renderer retains only the nation/detail sources it used, avoiding reloads on repeated LOD changes. */
export const createMonumentSceneAssets = (uniforms: Record<string, IUniform>) => {
  const held = new Map<string, ReturnType<typeof retainMonumentAsset>>();
  let disposed = false;
  return {
    watch: (root: Group, nation: WorkerNation, detailed: boolean) => {
      const key = `${nation}/${detailed}`;
      if (!isBuildingFirstNation(nation) && !held.has(key)) held.set(key, retainMonumentAsset(nation, detailed));
      void buildingAssetReady(root).then(() => {
        if (disposed || root.userData.disposed) return;
        const materials = new Set<MeshStandardMaterial>();
        root.traverse(object => { if (object instanceof Mesh)
          for (const material of meshMaterials(object)) if (material instanceof MeshStandardMaterial) materials.add(material); });
        connectSunShadowReceivers([...materials], uniforms);
        return undefined;
      }).catch(error => { if (!disposed && !root.userData.disposed) console.error("Monument asset could not load", error); });
    },
    stats: (roots: Group[]) => {
      const cache = monumentAssetStats();
      let triangles = 0;
      for (const root of roots) root.traverse(object => { if (object instanceof Mesh)
        triangles += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3; });
      return { monumentSources: cache.assets, monumentReferences: cache.references, monumentPending: cache.pending,
        monumentInstances: roots.length, monumentTriangles: triangles };
    },
    dispose: () => { if (disposed) return; disposed = true;
      held.forEach(lease => lease.release()); held.clear(); }
  };
};

import { Box3, Color, Group, InstancedMesh, type IUniform, Matrix4, Mesh, MeshBasicMaterial,
  type MeshStandardMaterial, Object3D, Raycaster, type Scene, SRGBColorSpace, Vector3 } from "three";

import { getRoadDecorationItem } from "../../../../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantModel,   type OrnamentalPlantTier,ornamentalPlantUsesCanonicalIcon } from "../../../../../island-of-settlers-shared/src/road-plant-models";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { decorationModel } from "../../../render-common/content/decoration-model-recipes";
import type { EnvironmentState } from "../../../render-common/environment";
import { ornamentalOverviewLight } from "../../../render-common/plants/ornamental-overview-light";
import type { RoadDecorationGhostFrame } from "../../../render-common/renderer-contract";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { isMapSceneryUid } from "../../../shared/settlement/map-scenery";
import type { RoadDecorationFrame } from "../../../shared/settlement/road-decoration-state";
import { displayFogAt } from "../../../shared/world/fog-display";
import { FOG, type WorldData } from "../../../shared/world/world-data";
import { createDecorationFoliageSource } from "../plants/decoration-foliage-source";
import { createDecorationWindSway } from "../plants/decoration-wind-sway";
import { createOrnamentalPlantLod, type PlantLodCamera } from "../plants/ornamental-plant-lod";
import type { DecorationAssetLoader } from "../road-decoration-asset-loader";
import { createRoadDecorationHover } from "../road-decoration-hover";
import { createRoadDecorationTemplates, type PrepareDecorationTemplate } from "../road-decoration-templates";
import { type ContactShadowInstance,createContactShadowMesh } from "../three-contact-shadows";
import { createRoadDecorationShadowCasters } from "./road-decoration-shadow-casters";

type MaterialsFor = (nation: WorkerNation) => Record<BuildingSurface, MeshStandardMaterial>;
interface Batch { meshes: InstancedMesh[]; ids: number[] }
interface RequestCompletion { requested: Map<string, object>; refresh?: () => void }
const isBillboard = (item: string, tier: OrnamentalPlantTier) => {
  const asset = getRoadDecorationItem(item)?.plant;
  if (ornamentalPlantUsesCanonicalIcon(asset, tier)) return true;
  if (tier !== "far") return false;
  return Boolean(asset && ornamentalPlantModel(asset) === "flowering-peach");
};

/**
 * D08: near-tier catalog plants sway with the shared world wind (High only); billboards, far tiers,
 * climbers, frames and every other decoration stay static.
 */
const createPlantSway = (uniforms: Record<string, IUniform> | undefined, enabled: boolean):
PrepareDecorationTemplate | undefined => {
  if (!enabled || !uniforms) return undefined;
  const sway = createDecorationWindSway(uniforms);
  return (template, item, tier) => {
    if (tier !== "near" || !getRoadDecorationItem(item)?.plant || isBillboard(item, tier)) return template;
    return sway.prepare(template);
  };
};

// A pending import must not capture this renderer's lexical scope/world after disposal.
const onAssetCompleted = (target: RequestCompletion, item: string, token: object) => (template: unknown) => {
  if (target.requested.get(item) !== token) return;
  target.requested.delete(item);
  if (template) target.refresh?.();
};

/**
 * Static16-unit chunks share templates; world mutations and camera LOD transitions upload matrices.
 * `antialias` (the canvas has MSAA) selects alpha-to-coverage for the shared climber foliage.
 * `shadowScene` (D07b, presets with decoration shadows) receives depth twins of the near batches.
 * `windSway` (D08, `QualityPreset.decorationWind`) lets near catalog plants sway with the world wind.
 */
export const createThreeRoadDecorations = (world: WorldData, detailed: boolean, materialsFor: MaterialsFor,
  load?: DecorationAssetLoader, uniforms?: Record<string, IUniform>, antialias = true, shadowScene?: Scene,
  windSway = false) => {
  const root = new Group(); root.name = "owned_road_decorations";
  const ghostRoot = new Group(); ghostRoot.name = "road_decoration_preview";
  const contactShadows = uniforms ? createContactShadowMesh(uniforms) : undefined;
  const sunCasters = shadowScene && detailed ? createRoadDecorationShadowCasters(shadowScene) : undefined;
  if (contactShadows) {
    contactShadows.mesh.name = "road-decoration-contact-shadows";
    root.add(contactShadows.mesh);
  }
  let ghostItem: string | undefined;
  let ghostFrame: RoadDecorationGhostFrame | null | undefined;
  let latestFrames: readonly RoadDecorationFrame[] = [];
  const completion: RequestCompletion = { requested: new Map() };
  const requested = completion.requested;
  const ghostMaterials: (MeshStandardMaterial | MeshBasicMaterial)[] = [];
  const foliage = createDecorationFoliageSource({ antialias, detailed, uniforms });
  const templates = createRoadDecorationTemplates(materialsFor, detailed, load,
    { foliage, prepare: createPlantSway(uniforms, windSway) });
  const flowerColour = new Color();
  const lod = createOrnamentalPlantLod(detailed);
  const renderedTiers = new Map<number, OrnamentalPlantTier>();
  const renderedTier = (uid: number) => renderedTiers.get(uid) ?? lod.tierFor(uid);
  const batches = new Map<string, Batch>(), matrix = new Matrix4(), transform = new Object3D();
  const overviewBounds = new Map<number, Box3>(), overviewHit = new Vector3(), pickVolume = new Box3();
  const overviewMaterials = new Map<MeshBasicMaterial, number>(), overviewTint = new Color(1, 1, 1);
  const retainOverviewMaterial = (material: unknown, billboard: boolean) => {
    if (!billboard || !(material instanceof MeshBasicMaterial)) return;
    overviewMaterials.set(material, (overviewMaterials.get(material) ?? 0) + 1);
    material.color.copy(overviewTint);
  };
  let previous: readonly RoadDecorationFrame[] | undefined, fogRevision = -1, disposed = false;
  const templateFor = (item: string, uid?: number) => templates.get(item, uid === undefined ? "near" : renderedTier(uid));
  const setFlowerColour = (mesh: InstancedMesh, index: number, item: string, uid: number) => {
    if (!mesh.userData.plantFlower) return;
    const palette = templateFor(item, uid).flowerColour;
    if (!palette) return;
    flowerColour.setRGB(...palette, SRGBColorSpace); mesh.setColorAt(index, flowerColour);
  };
  const hover = createRoadDecorationHover(root, templateFor), visibleFrames = new Map<number, RoadDecorationFrame>();
  const clearBatch = (batch: Batch) => {
    for (const mesh of batch.meshes) {
      if (mesh.userData.canonicalLit && mesh.material instanceof MeshBasicMaterial) {
        const count = (overviewMaterials.get(mesh.material) ?? 1) - 1;
        if (count) overviewMaterials.set(mesh.material, count); else overviewMaterials.delete(mesh.material);
      }
      sunCasters?.remove(mesh); mesh.removeFromParent(); mesh.dispose();
    }
  };
  const clearGhost = () => {
    ghostRoot.clear(); ghostItem = undefined;
    for (const material of ghostMaterials) material.dispose();
    ghostMaterials.length = 0;
  };
  const retainAssets = () => {
    const entries = latestFrames.map(frame => ({ item: frame.item, tier: lod.tierFor(frame.uid) }));
    for (const frame of latestFrames) if (renderedTier(frame.uid) !== lod.tierFor(frame.uid))
      entries.push({ item: frame.item, tier: renderedTier(frame.uid) });
    if (ghostFrame) entries.push({ item: ghostFrame.item, tier: "near" });
    const ids = entries.map(entry => entry.item);
    const current = new Set<string>(ids);
    const keys = new Set(entries.map(entry => templates.keyFor(entry.item, entry.tier)));
    for (const item of requested.keys()) if (!keys.has(item)) requested.delete(item);
    hover.retain(current);
    templates.retainLods(entries);
  };
  const requestAsset = (item: string, retry = false, tier: OrnamentalPlantTier = "near") => {
    const key = templates.keyFor(item, tier);
    if (requested.has(key)) return;
    const token = {}; requested.set(key, token);
    void templates.request(item, retry, tier).then(onAssetCompleted(completion, key, token));
  };
  const updateGhost = (frame: RoadDecorationGhostFrame | null | undefined) => {
    if (disposed) return;
    if (ghostFrame?.item !== frame?.item) {
      clearGhost(); ghostFrame = frame; retainAssets();
    } else ghostFrame = frame;
    ghostRoot.visible = Boolean(frame);
    if (!frame) return;
    if (!templates.peek(frame.item)) { requestAsset(frame.item); return; }
    if (ghostItem !== frame.item) {
      clearGhost(); ghostItem = frame.item;
      for (const part of templateFor(frame.item).root.children) if (part instanceof Mesh && !Array.isArray(part.material)) {
        const original = part.material as MeshStandardMaterial | MeshBasicMaterial;
        const material = original.clone();
        material.onBeforeCompile = original.onBeforeCompile;
        material.customProgramCacheKey = original.customProgramCacheKey;
        material.transparent = true; material.opacity = .72; material.depthWrite = false;
        ghostMaterials.push(material);
        const mesh = new Mesh(part.geometry, material); mesh.renderOrder = 2; ghostRoot.add(mesh);
      }
    }
    for (const material of ghostMaterials) {
      material.color.setHex(frame.valid ? 0xb1e8a3 : 0xff6048);
      if ("emissive" in material) {
        material.emissive.setHex(frame.valid ? 0x172610 : 0x3b0a05); material.emissiveIntensity = .6;
      }
    }
    ghostRoot.position.set(...frame.position); ghostRoot.rotation.y = frame.yaw;
  };
  const rebuildContactShadows = () => {
    if (!contactShadows) return;
    const entries: ContactShadowInstance[] = [];
    for (const frame of visibleFrames.values()) {
      const item = getRoadDecorationItem(frame.item);
      const definition = item && decorationModel(item.decoration);
      const local = definition?.placement === "across-road" && frame.supports.length > 0
        ? frame.supports : [undefined];
      if (definition?.placement === "across-road" && frame.supports.length === 0) continue;
      for (const box of local) {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        if (box) { minX = box.min[0]; minZ = box.min[2]; maxX = box.max[0]; maxZ = box.max[2]; }
        else for (const volume of frame.volumes) {
          minX = Math.min(minX, volume.min[0]); minZ = Math.min(minZ, volume.min[2]);
          maxX = Math.max(maxX, volume.max[0]); maxZ = Math.max(maxZ, volume.max[2]);
        }
        if (!Number.isFinite(minX)) continue;
        const support = definition?.placement === "across-road";
        const radius = .55 * Math.max(maxX - minX, maxZ - minZ);
        entries.push({ fog: 1, radius: Math.min(support ? .7 : 1.6, Math.max(.25, radius)),
          x: (minX + maxX) / 2, y: frame.position[1], z: (minZ + maxZ) / 2 });
      }
    }
    contactShadows.update(entries);
  };
  const prepareRenderedTiers = (frames: readonly RoadDecorationFrame[]) => {
    const activeUids = new Set(frames.map(frame => frame.uid));
    for (const uid of renderedTiers.keys()) if (!activeUids.has(uid)) renderedTiers.delete(uid);
    for (const frame of frames) {
      const desired = lod.tierFor(frame.uid), current = renderedTiers.get(frame.uid);
      let tier = desired;
      if (!templates.peek(frame.item, desired) && current && templates.peek(frame.item, current)) tier = current;
      renderedTiers.set(frame.uid, tier);
    }
  };
  const update = (frames: readonly RoadDecorationFrame[], camera?: PlantLodCamera, viewportHeight?: number) => {
    if (disposed) return;
    if (lod.update(frames, camera, viewportHeight)) previous = undefined;
    if (previous === frames && fogRevision === (world.fogRevision ?? 0)) {
      if (templates.hasErrors()) {
        for (const frame of latestFrames) {
          const tier = lod.tierFor(frame.uid);
          if (!templates.peek(frame.item, tier)) requestAsset(frame.item, false, tier);
        }
      }
      return;
    }
    latestFrames = frames; prepareRenderedTiers(frames);
    retainAssets();
    // Keep the old visible representation until the next asynchronous tier is ready.
    for (const frame of frames) {
      const desired = lod.tierFor(frame.uid);
      if (!templates.peek(frame.item, desired)) requestAsset(frame.item, false, desired);
    }
    previous = frames; fogRevision = world.fogRevision ?? 0;
    visibleFrames.clear(); overviewBounds.clear();
    const groups = new Map<string, RoadDecorationFrame[]>();
    for (const frame of frames) {
      const cell = Math.floor(frame.position[2]) * world.cellsX + Math.floor(frame.position[0]);
      if (displayFogAt(world, cell) === FOG.hidden) continue;
      visibleFrames.set(frame.uid, frame);
      const tier = renderedTier(frame.uid);
      const billboard = isBillboard(frame.item, tier);
      let region = `${Math.floor(frame.position[0] / 16)}:${Math.floor(frame.position[2] / 16)}`;
      if (billboard) region = "overview";
      const key = `${templates.keyFor(frame.item, tier)}/${region}`;
      const group = groups.get(key) ?? []; group.push(frame); groups.set(key, group);
    }
    for (const [key, batch] of batches) if (!groups.has(key)) { clearBatch(batch); batches.delete(key); }
    for (const [key, entries] of groups) {
      const tier = renderedTier(entries[0]!.uid);
      const template = templates.peek(entries[0]!.item, tier);
      if (!template) { requestAsset(entries[0]!.item, false, tier); continue; }
      const billboard = isBillboard(entries[0]!.item, tier);
      if (billboard) for (const entry of entries) {
        const bounds = new Box3();
        for (const box of entry.volumes) {
          bounds.min.x = Math.min(bounds.min.x, box.min[0]); bounds.min.y = Math.min(bounds.min.y, box.min[1]);
          bounds.min.z = Math.min(bounds.min.z, box.min[2]); bounds.max.x = Math.max(bounds.max.x, box.max[0]);
          bounds.max.y = Math.max(bounds.max.y, box.max[1]); bounds.max.z = Math.max(bounds.max.z, box.max[2]);
        }
        if (!bounds.isEmpty()) overviewBounds.set(entry.uid, bounds);
      }
      let batch = batches.get(key);
      if (!batch || batch.meshes[0]!.instanceMatrix.count < entries.length) {
        if (batch) clearBatch(batch);
        const capacity = 2 ** Math.ceil(Math.log2(Math.max(1, entries.length)));
        batch = { meshes: [], ids: [] };
        for (const part of template.root.children) if (part instanceof Mesh && !Array.isArray(part.material)) {
          const mesh = new InstancedMesh(part.geometry, part.material, capacity);
          mesh.customDepthMaterial = part.customDepthMaterial; mesh.customDistanceMaterial = part.customDistanceMaterial;
          mesh.userData.plantOverview = billboard;
          mesh.userData.canonicalLit = billboard || part.name === "peach-original-crown-masses";
          retainOverviewMaterial(part.material, mesh.userData.canonicalLit);
          mesh.name = `${key}/${part.name}`; mesh.castShadow = detailed && tier !== "overview"; mesh.receiveShadow = detailed;
          mesh.userData.plantFlower = Boolean(template.flowerColour && part.name === "paint");
          batch.meshes.push(mesh); root.add(mesh); sunCasters?.add(mesh);
        }
        batches.set(key, batch);
      }
      batch.ids = entries.map(entry => entry.uid);
      for (const mesh of batch.meshes) {
        mesh.count = entries.length;
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index]!;
          transform.position.set(...entry.position); transform.rotation.set(0, entry.yaw, 0); transform.updateMatrix();
          matrix.copy(transform.matrix); mesh.setMatrixAt(index, matrix);
          setFlowerColour(mesh, index, entry.item, entry.uid);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingBox(); mesh.computeBoundingSphere(); sunCasters?.sync(mesh);
      }
    }
    rebuildContactShadows();
    const hovered = hover.statistics().uid;
    if (hovered !== null) {
      const frame = visibleFrames.get(hovered);
      if (!frame || templates.peek(frame.item, renderedTier(frame.uid))) hover.set(frame);
      else hover.set();
    }
  };
  const pick = (raycaster: Raycaster) => {
    // Billboard positions are GPU-facing; CPU XY quad raycasts cannot represent their real item contact.
    const solid = root.children.filter(mesh => !mesh.userData.plantOverview &&
      !mesh.name.endsWith("/peach-original-crown-masses"));
    let nearest: { uid: number; distance: number } | undefined;
    // Fixed map scenery (negative uids) is never picked: clicks pass through it like natural props.
    for (const hit of raycaster.intersectObjects(solid, false)) {
      if (hit.instanceId === undefined) continue;
      const batch = [...batches.values()].find(candidate => candidate.meshes.includes(hit.object as InstancedMesh));
      const uid = batch?.ids[hit.instanceId];
      if (uid === undefined || isMapSceneryUid(uid)) continue;
      nearest = { uid, distance: hit.distance };
      break;
    }
    for (const [uid, bounds] of overviewBounds) {
      if (isMapSceneryUid(uid) || !raycaster.ray.intersectBox(bounds, overviewHit)) continue;
      let distance = Infinity;
      // Test the semantic body after the cheap broad phase; transparent crown padding is not a ground wall.
      for (const box of visibleFrames.get(uid)!.volumes) {
        pickVolume.min.set(...box.min); pickVolume.max.set(...box.max);
        if (raycaster.ray.intersectBox(pickVolume, overviewHit))
          distance = Math.min(distance, raycaster.ray.origin.distanceTo(overviewHit));
      }
      if (!Number.isFinite(distance)) continue;
      if (distance < raycaster.near || distance > raycaster.far || nearest && distance >= nearest.distance) continue;
      nearest = { uid, distance };
    }
    return nearest;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; completion.refresh = undefined; completion.requested.clear();
    ghostFrame = undefined; latestFrames = []; lod.dispose(); renderedTiers.clear();
    clearGhost(); ghostRoot.removeFromParent(); contactShadows?.dispose();
    hover.dispose(); visibleFrames.clear(); overviewBounds.clear();
    for (const batch of batches.values()) clearBatch(batch);
    batches.clear(); sunCasters?.dispose();
    templates.dispose(); foliage.dispose(); root.removeFromParent(); root.clear();
  };
  const updateEnvironment = (environment: EnvironmentState) => {
    if (disposed) return;
    overviewTint.setRGB(...ornamentalOverviewLight(environment));
    for (const material of overviewMaterials.keys()) material.color.copy(overviewTint);
  };
  completion.refresh = () => {
    previous = undefined; update(latestFrames); updateGhost(ghostFrame);
  };
  return { root, ghostRoot, updateGhost, update, updateEnvironment, pick, dispose,
    setHover: (uid: number | null) => {
      const frame = uid === null || isMapSceneryUid(uid) ? undefined : visibleFrames.get(uid);
      if (frame && !templates.peek(frame.item, renderedTier(frame.uid))) return false;
      return hover.set(frame);
    },
    ready: async () => { await templates.ready(); },
    retryAssets: () => {
      for (const frame of latestFrames) requestAsset(frame.item, true, lod.tierFor(frame.uid));
      if (ghostFrame) requestAsset(ghostFrame.item, true);
    },
    hoverStatistics: hover.statistics,
    statistics: () => ({ ...templates.statistics(), batches: [...batches.values()].reduce((sum, batch) => sum + batch.meshes.length, 0),
      instances: [...batches.values()].reduce((sum, batch) => sum + batch.ids.length, 0),
      ...sunCasters?.statistics() }) };
};

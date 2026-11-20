import {
  Box3, BoxGeometry, DataTexture, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, RepeatWrapping, RGBAFormat, SRGBColorSpace
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingDefinition, BuildingFrame } from "../../../render-common/buildings/building-catalog";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { createWareRecipe } from "../../../render-common/wares/ware-recipe";
import { getConstructionCost } from "../../../shared/settlement/construction-costs";
import { constructionStockDisplayCapacity, constructionStockLayout } from "../../../shared/settlement/construction-stock-layout";
import { sinHash2 } from "../../../shared/world/noise";
import { createRomanPartGeometry } from "../buildings/roman-building";
import { disposeMeshGeometries } from "../three-mesh-resources";
import { createConstructionScaffolding } from "./construction-scaffolding";
import { type ConstructionGround,createConstructionGroundFitter } from "./construction-site-ground";

const sandyTexture = (width: number, depth: number) => {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = sinHash2(x, y);
    const offset = (y * size + x) * 4;
    pixels[offset] = 168 + grain * 50;
    pixels[offset + 1] = 137 + grain * 44;
    pixels[offset + 2] = 90 + grain * 35;
    pixels[offset + 3] = 155 + grain * 70;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(width, depth);
  texture.needsUpdate = true;
  return texture;
};

/** Temporary site materials use the same original ware models as actual carrier cargo. */
export const createConstructionPlan = (
  definition: BuildingDefinition, detailed = true,
  materials?: Record<BuildingSurface, MeshStandardMaterial>, terrain?: ConstructionGround,
  nation?: WorkerNation
) => {
  const root = new Group();
  root.name = "construction_site";
  const [width, depth] = definition.gridFootprint;
  const texture = sandyTexture(width, depth);
  const sand = new MeshBasicMaterial({ map: texture, opacity: 0.43, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const ground = new Mesh(new PlaneGeometry(width - 0.08, depth - 0.08, width, depth), sand);
  ground.name = "construction_sand";
  ground.geometry.rotateX(-Math.PI / 2);
  ground.geometry.translate(0, 0.025, 0);
  root.add(ground);
  const stakeMaterial = new MeshStandardMaterial({ color: 0x78583d, roughness: 0.94 });
  const stakeParts = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const geometry = new BoxGeometry(0.045, 0.32, 0.045);
    geometry.translate(x * (width / 2 - 0.1), 0.16, z * (depth / 2 - 0.1));
    stakeParts.push(geometry);
  }
  const stakes = new Mesh(mergeGeometries(stakeParts)!, stakeMaterial);
  stakeParts.forEach((geometry) => geometry.dispose());
  stakes.name = "construction_survey_stakes";
  root.add(stakes);
  const scaffold = createConstructionScaffolding(definition,detailed,materials?.wood ?? stakeMaterial);
  root.add(scaffold.root);
  const stockMeshes = new Map<string, InstancedMesh[]>();
  const receipt = getConstructionCost(definition.id, nation);
  for (const [ware, requiredCapacity] of Object.entries(receipt)) {
    const capacity = constructionStockDisplayCapacity(receipt, ware);
    if (!capacity) continue;
    const recipe = createWareRecipe(ware, detailed);
    const wareParts = recipe.parts.map((part) => ({ part, geometry: createRomanPartGeometry(part, detailed) }));
    const bounds = new Box3();
    for (const { geometry } of wareParts) {
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox!);
    }
    const pitch = bounds.max.y - bounds.min.y + 0.018;
    const meshes: InstancedMesh[] = [];
    for (const surface of new Set(recipe.parts.map((part) => part.surface))) {
      const geometries = wareParts.filter((entry) => entry.part.surface === surface).map((entry) => entry.geometry.index ? entry.geometry.toNonIndexed() : entry.geometry.clone());
      const merged = mergeGeometries(geometries)!;
      geometries.forEach((geometry) => geometry.dispose());
      const fallback = materials?.[surface] ?? stakeMaterial;
      const mesh = new InstancedMesh(merged, fallback, capacity);
      mesh.name = `construction_${ware}_${surface}`;
      mesh.userData.constructionWare = ware;
      mesh.userData.capacity = capacity;
      mesh.userData.requiredCapacity = requiredCapacity;
      mesh.count = 0;
      mesh.frustumCulled = false;
      for (let slot = 0; slot < capacity; slot++) {
        const layout = constructionStockLayout(receipt, ware, slot, width, depth)!;
        mesh.setMatrixAt(slot, new Matrix4().makeTranslation(layout.x, -bounds.min.y + 0.03 + layout.layer * pitch, layout.z));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = detailed;
      mesh.receiveShadow = true;
      meshes.push(mesh);
      root.add(mesh);
    }
    wareParts.forEach(({ geometry }) => geometry.dispose());
    stockMeshes.set(ware, meshes);
  }
  const fitGround = createConstructionGroundFitter(root, terrain, [ground, stakes, ...scaffold.surfaces], [...stockMeshes.values()].flat());
  return {
    root,
    update: (frame: Pick<BuildingFrame, "construction" | "inputStock">) => {
      root.visible = frame.construction < 1;
      if (root.visible) fitGround();
      scaffold.update(frame.construction);
      for (const [ware, meshes] of stockMeshes)
        for (const mesh of meshes) {
          mesh.count = Math.min(mesh.userData.capacity, Math.max(0, Math.floor(frame.inputStock?.[ware] ?? 0)));
          mesh.visible = mesh.count > 0;
        }
    },
    dispose: () => {
      disposeMeshGeometries(root);
      texture.dispose();
      sand.dispose();
      stakeMaterial.dispose();
    }
  };
};

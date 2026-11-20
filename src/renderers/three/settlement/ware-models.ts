import { Box3, DataTexture, Group, Mesh, type MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { type MaterialWoodWare, stoneWareAppearance, woodWareAppearance } from "../../../render-common/wares/advanced-material-variants";
import { SPYGLASS_TOOL_SCALE } from "../../../render-common/wares/spyglass-parts";
import { CARGO_BOX_WARE, COIN_CHEST_WARE, coinCargoStack, resolveWareId, TOOL_WARES } from "../../../render-common/wares/ware-catalog";
import { PIG_VISUAL_SCALE } from "../../../render-common/wares/ware-dimensions";
import { createWareRecipe } from "../../../render-common/wares/ware-recipe";
import { WORKER_SCALE } from "../../../render-common/workers/worker-dimensions";
import { createImportedPig } from "../buildings/imported-pig";
import { createRomanPartGeometry } from "../buildings/roman-building";
import { disposeMeshGeometries } from "../three-mesh-resources";
import { acquireAdvancedMaterials } from "./advanced-material-assets";
import { createCoinChestModel } from "./coin-chest-model";
import { acquireCoinFaceMaterial } from "./coin-face-material";
import { createImportedAdvancedWare } from "./imported-advanced-ware";
import { createIronIngotMaterial } from "./iron-ingot-material";

/** The caller owns shared surface textures; each ware owns its geometry and specialized material clones. */
/** Round-part segments of an overridden ware recipe: grapes stay coarse even when detailed. */
const getOverrideRadialSegments = (detailed: boolean, id: string | null | undefined) => {
  if (id === "coins") return detailed ? 32 : 16;
  if (id === "basalt") return 6;
  if (id === "flax") return detailed ? 4 : 3;
  if (!detailed) return 3;
  return id === "grapes" ? 4 : 8;
};
/** A small procedural linen weave, shared by cloth icons, stock and carried bolts. */
let linenWeaveTexture: DataTexture | undefined;
const linenWeave = () => {
  if (linenWeaveTexture) return linenWeaveTexture;
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const warp = Math.sin(((x % 8) + .5) / 8 * Math.PI);
    const weft = Math.sin(((y % 8) + .5) / 8 * Math.PI);
    const warpOnTop = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
    const yarn = warpOnTop ? warp : weft;
    const under = warpOnTop ? weft : warp;
    const fibre = .025 * Math.sin(x * 2.8 + y * .9) + .018 * Math.cos(y * 3.1 - x * .7);
    const threadVariation = .025 * Math.sin(Math.floor(x / 8) * 2.4 + Math.floor(y / 8) * 1.7);
    const shade = .58 + .30 * yarn + .07 * under + fibre + threadVariation;
    const index = (y * size + x) * 4;
    data[index] = Math.max(0, Math.min(255, Math.round(220 * shade)));
    data[index + 1] = Math.max(0, Math.min(255, Math.round(207 * shade)));
    data[index + 2] = Math.max(0, Math.min(255, Math.round(176 * shade)));
    data[index + 3] = 255;
  }
  linenWeaveTexture = new DataTexture(data, size, size, RGBAFormat);
  linenWeaveTexture.wrapS = linenWeaveTexture.wrapT = RepeatWrapping;
  linenWeaveTexture.repeat.set(2, 2);
  linenWeaveTexture.anisotropy = 4;
  linenWeaveTexture.colorSpace = SRGBColorSpace;
  linenWeaveTexture.needsUpdate = true;
  return linenWeaveTexture;
};
/** Flax ties and cloth bolts need linen, not the dark-red building flag material. */
const linenMaterials = new WeakMap<MeshStandardMaterial, MeshStandardMaterial>();
const linenMaterial = (base: MeshStandardMaterial) => {
  let linen = linenMaterials.get(base);
  if (!linen) {
    linen = base.clone();
    linen.color.setHex(0xf0dfbc);
    // Replace the dark-red flag cloth with a neutral woven linen texture.
    linen.map = linenWeave();
    linen.bumpMap = base.normalMap ? linen.map : null;
    linen.bumpScale = .0025;
    linen.normalMap = null;
    linen.roughnessMap = null;
    linen.roughness = 1;
    linen.metalness = 0;
    linenMaterials.set(base, linen);
  }
  return linen;
};

/** The many fine stalks share two draws, rather than submitting each stem and capsule. */
const mergeFlaxMeshes = (shape: Group, detailed: boolean) => {
  const groups = new Map<MeshStandardMaterial, Mesh[]>();
  for (const child of shape.children) {
    const mesh = child as Mesh;
    const material = mesh.material as MeshStandardMaterial;
    const meshes = groups.get(material) ?? [];
    meshes.push(mesh); groups.set(material, meshes);
  }
  for (const [material, meshes] of groups) {
    const geometry = mergeGeometries(meshes.map(mesh => mesh.geometry))!;
    for (const mesh of meshes) { mesh.geometry.dispose(); mesh.removeFromParent(); }
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = detailed;
    shape.add(mesh);
  }
};

/**
 * One mesh per material (and attribute layout) under `ware_geometry`: a stock slot or a carried load
 * stays cheap to draw without changing its authored vertices or physical envelope.
 */
export const mergeWareShapeMeshes = (root: Group) => {
  const shape = root.getObjectByName("ware_geometry");
  if (!shape) return;
  const batches = new Map<MeshStandardMaterial, Map<string, Mesh[]>>();
  for (const child of shape.children) {
    if (!(child instanceof Mesh) || Array.isArray(child.material)) continue;
    const material = child.material as MeshStandardMaterial;
    const signature = Object.keys(child.geometry.attributes).map(name => {
      const attribute = child.geometry.getAttribute(name);
      return `${name}:${attribute.itemSize}:${attribute.normalized}`;
    }).sort().join("|");
    let groups = batches.get(material);
    if (!groups) { groups = new Map(); batches.set(material, groups); }
    const meshes = groups.get(signature) ?? [];
    meshes.push(child); groups.set(signature, meshes);
  }
  for (const [material, groups] of batches) for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(geometries);
    for (const temporary of geometries) temporary.dispose();
    if (!geometry) continue;
    const merged = new Mesh(geometry, material);
    merged.castShadow = meshes[0]!.castShadow; merged.receiveShadow = meshes[0]!.receiveShadow;
    for (const mesh of meshes) { mesh.geometry.dispose(); mesh.removeFromParent(); }
    shape.add(merged);
  }
};

interface WareModel {
  dispose: () => void;
  recipe: ReturnType<typeof createWareRecipe>;
  root: Group;
  triangles: () => number;
}
export const createWareModel = (
  ware: string,
  detailed: boolean,
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  pose: "stock" | "carry" | "tool" = "stock",
  recipeOverride?: ReturnType<typeof createWareRecipe>
): WareModel => {
  const stack = coinCargoStack(ware);
  if (stack) {
    const root = new Group(), shape = new Group(); shape.name = "ware_geometry"; root.add(shape);
    root.name = "coin_cargo_stack"; root.userData.sharedWareMaterials = true;
    const loads = stack.map(visual => createWareModel(visual, detailed, materials, pose));
    let height = 0;
    for (const load of loads) {
      const bounds = new Box3().setFromObject(load.root);
      load.root.position.y = height - bounds.min.y;
      height += bounds.max.y - bounds.min.y;
      shape.add(load.root);
    }
    root.userData.disposeOwnedMaterials = () => loads.forEach(load => load.root.userData.disposeOwnedMaterials?.());
    return { root, recipe: createWareRecipe(CARGO_BOX_WARE, detailed),
      triangles: () => loads.reduce((sum, load) => sum + load.triangles(), 0),
      dispose: () => {
        disposeMeshGeometries(root); root.userData.disposeOwnedMaterials(); root.removeFromParent();
      } };
  }
  if (ware === COIN_CHEST_WARE) {
    const chest = createCoinChestModel({ detailed, lid: "closed", units: 0 });
    const shape = new Group(); shape.name = "ware_geometry";
    shape.add(...chest.root.children); chest.root.add(shape);
    if (pose === "carry") shape.scale.setScalar(1 / WORKER_SCALE);
    return { root: chest.root, dispose: chest.dispose, triangles: () => chest.triangles,
      recipe: createWareRecipe(CARGO_BOX_WARE, detailed) };
  }
  const recipe = recipeOverride ?? createWareRecipe(ware, detailed);
  const root = new Group();
  root.name = `ware_${recipe.id ?? ware}`;
  root.userData.ware = recipe.id ?? ware;
  root.userData.sharedWareMaterials = true;
  const shape = new Group();
  shape.name = "ware_geometry";
  if (ware === "spyglass" && pose === "tool") shape.scale.setScalar(SPYGLASS_TOOL_SCALE);
  root.add(shape);
  if (recipe.id && woodWareAppearance(recipe.id)) {
    const imported = createImportedAdvancedWare(recipe.id as MaterialWoodWare, detailed);
    shape.add(imported.root);
    root.userData.disposeOwnedMaterials = imported.dispose;
    return { recipe, root, triangles: () => {
      let count = 0;
      root.traverse(object => { if (object instanceof Mesh) count +=
        (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3; });
      return count;
    }, dispose: () => {
      disposeMeshGeometries(root);
      imported.dispose(); root.removeFromParent();
    } };

  }
  const marble = recipe.id && stoneWareAppearance(recipe.id) ? acquireAdvancedMaterials("deposit", detailed, recipe.id) : undefined;
  if (marble) root.userData.disposeOwnedMaterials = marble.release;
  const ingotMaterial = recipe.id === "iron" ? createIronIngotMaterial(materials.steel) : undefined;
  if (ingotMaterial) root.userData.disposeOwnedMaterials = () => ingotMaterial.dispose();
  const coinFace = recipe.id === "coins" ? acquireCoinFaceMaterial(materials.gold, detailed) : undefined;
  if (coinFace) root.userData.disposeOwnedMaterials = coinFace.release;
  if (recipe.id === "pig") {
    const animal = createImportedPig(detailed);
    animal.pig.scale.setScalar(PIG_VISUAL_SCALE);
    animal.pig.rotation.y = Math.PI / 2;
    animal.pig.position.y = -.073;
    shape.add(animal.pig);
    return { recipe, root, triangles: () => animal.mesh.geometry.index!.count / 3,
      dispose: () => { animal.dispose(); root.removeFromParent(); } };
  }
  for (const part of recipe.parts) {
    const geometryPart = recipeOverride
      ? { ...part, radialSegments: getOverrideRadialSegments(detailed, recipe.id),
        stock: { ware: recipe.id ?? ware, slot: 0 } }
      : part;
    const geometry = createRomanPartGeometry(geometryPart, detailed);
    // Closed beer vessels hide the ring's inner wall and the body's covered end annuli.
    if (recipeOverride && !detailed && recipe.id === "beer" && part.shape === "ring") {
      const original = Array.from(geometry.index!.array), indices: number[] = [];
      for (let offset = 0; offset < original.length; offset += 24) {
        indices.push(...original.slice(offset, offset + 6));
        if (part.surface === "iron") indices.push(...original.slice(offset + 12, offset + 24));
      }
      geometry.setIndex(indices);
    }
    if (recipeOverride && !detailed && recipe.id === "crucible" && part.shape === "ring") {
      const original = Array.from(geometry.index!.array), indices: number[] = [];
      for (let offset = 0; offset < original.length; offset += 24) indices.push(...original.slice(offset, offset + 18));
      geometry.setIndex(indices);
    }
    // Adjacent binding segments hide their end faces; board straps hide their inward broad faces.
    if (recipeOverride && !detailed && part.surface === "rope" && part.shape === "box" &&
      ["grain", "planks"].includes(recipe.id ?? "")) {
      const indices = Array.from(geometry.index!.array);
      geometry.setIndex(recipe.id === "grain" ? [...indices.slice(0, 12), ...indices.slice(24)] : indices.slice(0, 24));
    }
    const stoneBody = marble && Math.min(...part.size) > .005;
    const baseMaterial = part.surface === "paint" && coinFace ? coinFace.material
      : ingotMaterial ?? (stoneBody ? marble.materials[0]! : materials[part.surface]!);
    const material = (recipe.id === "flax" || recipe.id === "cloth") && part.surface === "cloth"
      ? linenMaterial(baseMaterial) : baseMaterial;
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = detailed;
    mesh.receiveShadow = detailed;
    shape.add(mesh);
  }
  const id = resolveWareId(ware);
  if (id === "flax") mergeFlaxMeshes(shape, detailed);
  if (pose === "carry" && id === "flour") shape.rotation.z = Math.PI / 2;
  if (pose === "carry" && id === "grain") shape.rotation.y = Math.PI / 2;
  if (pose === "carry" && id === "meat") shape.rotation.x = Math.PI / 2;
  if (pose === "carry" && id && TOOL_WARES.has(id)) shape.rotation.z = Math.PI / 2;
  // A carried load is drawn once per carrier: its parts share one draw per material (perf lane).
  if (pose !== "stock") mergeWareShapeMeshes(root);
  const dispose = () => {
    disposeMeshGeometries(shape);
    marble?.release();
    ingotMaterial?.dispose();
    coinFace?.release();
    root.removeFromParent();
  };
  const triangles = () => {
    let count = 0;
    shape.traverse((object) => {
      if (object instanceof Mesh)
        count +=
          (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
    });
    return count;
  };
  return { dispose, recipe, root, triangles };
};

import { BufferGeometry, Group, Mesh, type MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  type BridgeTimberFinish, TIERED_TIMBER_SURFACES
} from "../../../render-common/bridges/bridge-level-finish";
import type { BridgeRecipe, BridgeRecipePart } from "../../../render-common/bridges/bridge-recipe";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { RoadDecorationPart } from "../../../render-common/road-decoration-recipe";
import { createRomanPartGeometry } from "../buildings/roman-building";
import { finishRoadDecorationStoneGeometry } from "../road-decoration-stone-geometry";
import { createRoadDecorationStoneMaterial } from "../road-decoration-stone-material";
import type { StoneSurfaceFamily } from "../road-decoration-stone-samples";
import { createBridgeTimberMaterial } from "./bridge-timber-material";

const STONE_SURFACES: readonly BuildingSurface[] = ["stone", "cut-stone", "plaster"];

interface SurfacePart {
  boundary: number;
  stage: BridgeRecipePart["stage"];
}

interface SurfaceBatch {
  mesh: Mesh;
  parts: SurfacePart[];
}

const createPartGeometry = (part: RoadDecorationPart, detailed: boolean): BufferGeometry => {
  if ("kind" in part) throw new Error(`Unsupported bridge decoration part: ${part.kind}`);
  return createRomanPartGeometry(part, detailed);
};

/** Bridges are built from building parts only; decoration foliage never reaches them. */
const bridgeSurface = (part: RoadDecorationPart): BuildingSurface => {
  if (part.surface === "foliage") throw new Error("Unsupported bridge decoration surface: foliage");
  return part.surface;
};

const normalizePartGeometry = (
  part: RoadDecorationPart, detailed: boolean, stoneFamily: StoneSurfaceFamily | undefined
) => {
  let geometry = createPartGeometry(part, detailed);
  if (geometry.index) {
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    geometry = flat;
  }
  if (stoneFamily && STONE_SURFACES.includes(bridgeSurface(part)))
    finishRoadDecorationStoneGeometry(geometry, detailed, true);
  geometry.clearGroups();
  for (const key of Object.keys(geometry.attributes))
    if (!["position", "normal", "uv", "color"].includes(key)) geometry.deleteAttribute(key);
  return geometry;
};

const stageProgress = (progress: number): [number, number, number] => {
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped < 0.35) return [clamped / 0.35, 0, 0];
  if (clamped < 0.8) return [1, (clamped - 0.35) / 0.45, 0];
  return [1, 1, (clamped - 0.8) / 0.2];
};

const drawnBoundary = (parts: readonly SurfacePart[], fractions: [number, number, number]) => {
  const perStage: [number, number, number] = [0, 0, 0];
  for (const part of parts) perStage[part.stage] += 1;
  const drawnInStage: [number, number, number] = [0, 0, 0];
  for (let stage = 0; stage < 3; stage += 1) {
    const count = perStage[stage] ?? 0;
    if (!count) continue;
    drawnInStage[stage] = Math.min(count, Math.floor((fractions[stage] ?? 0) * count + 1e-9));
  }
  const seen: [number, number, number] = [0, 0, 0];
  let boundary = 0;
  for (const part of parts) {
    seen[part.stage] += 1;
    if (seen[part.stage] <= drawnInStage[part.stage]) boundary = part.boundary;
  }
  return boundary;
};

/** Merges each bridge surface once and advances its draw range through the three build stages. */
export const createBridgeModel = (
  recipe: BridgeRecipe,
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean,
  stoneFamily?: StoneSurfaceFamily,
  /**
   * A wooden bridge's timber: tier maps on beams, posts and deck planks from level 2; at level 1 only
   * the deck (Minimal's pole slabs) is painted. Absent for stone bridges.
   */
  timber?: BridgeTimberFinish
) => {
  const root = new Group();
  root.name = "bridge_model";
  const bySurface = new Map<BuildingSurface, { geometry: BufferGeometry; stage: BridgeRecipePart["stage"] }[]>();
  for (const { part, stage } of recipe.parts) {
    const surface = bridgeSurface(part), list = bySurface.get(surface) ?? [];
    list.push({ geometry: normalizePartGeometry(part, detailed, stoneFamily), stage });
    bySurface.set(surface, list);
  }
  const batches: SurfaceBatch[] = [];
  const ownedMaterials: MeshStandardMaterial[] = [];
  let triangles = 0;
  for (const [surface, entries] of bySurface) {
    const counts = entries.map(entry => entry.geometry.getAttribute("position").count);
    const merged = mergeGeometries(entries.map(entry => entry.geometry));
    for (const entry of entries) entry.geometry.dispose();
    if (!merged) throw new Error(`Unable to batch bridge surface: ${surface}`);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    triangles += merged.getAttribute("position").count / 3;
    let material = materials[surface];
    if (stoneFamily && STONE_SURFACES.includes(surface)) {
      material = createRoadDecorationStoneMaterial(material, detailed, stoneFamily);
      ownedMaterials.push(material);
    } else if (timber && TIERED_TIMBER_SURFACES.has(surface) && (timber !== "softwood" || surface === "planks")) {
      material = createBridgeTimberMaterial(material, detailed, timber, surface === "planks");
      ownedMaterials.push(material);
    }
    const mesh = new Mesh(merged, material);
    mesh.name = `${surface}_bridge`;
    mesh.castShadow = detailed;
    mesh.receiveShadow = detailed;
    mesh.geometry.setDrawRange(0, 0);
    root.add(mesh);
    let boundary = 0;
    const parts: SurfacePart[] = entries.map((entry, index) => {
      boundary += counts[index]!;
      return { boundary, stage: entry.stage };
    });
    batches.push({ mesh, parts });
  }
  const setProgress = (progress: number) => {
    const fractions = stageProgress(progress);
    for (const batch of batches)
      batch.mesh.geometry.setDrawRange(0, drawnBoundary(batch.parts, fractions));
  };
  const dispose = () => {
    for (const batch of batches) batch.mesh.geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    root.clear();
    root.removeFromParent();
  };
  setProgress(1);
  return { dispose, root, setProgress, triangles };
};

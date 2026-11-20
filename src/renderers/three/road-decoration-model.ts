import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh,
  type MeshStandardMaterial, Shape } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import type { RoadArchStone, RoadDecorationRecipe } from "../../render-common/road-decoration-recipe";
import { createRomanPartGeometry } from "./buildings/roman-building";
import type { DecorationFoliageMaterials } from "./plants/decoration-foliage-material";
import { createRoadClimberStemGeometry, createRoadFoliageGeometry } from "./road-decoration-foliage-geometry";
import { createRoadDecorationLeaf } from "./road-decoration-leaf";
import { createRoadDecorationProfile } from "./road-decoration-profiles";
import { createRoadDecorationRaceme } from "./road-decoration-raceme";
import { createRoadRubbleGeometry } from "./road-decoration-rubble";
import { finishRoadDecorationStoneGeometry } from "./road-decoration-stone-geometry";
import { createRoadDecorationStoneMaterial } from "./road-decoration-stone-material";
import { createRomanColumnGeometry } from "./roman-column-decoration";

const archStoneGeometry = (part: RoadArchStone, detailed: boolean) => {
  const shape = new Shape(), count = detailed ? 3 : 1, outer = part.innerRadius + part.thickness;
  for (let index = 0; index <= count; index++) {
    const angle = part.from + (part.to - part.from) * index / count;
    const x = Math.cos(angle) * outer, y = Math.sin(angle) * outer;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let index = count; index >= 0; index--) {
    const angle = part.from + (part.to - part.from) * index / count;
    shape.lineTo(Math.cos(angle) * part.innerRadius, Math.sin(angle) * part.innerRadius);
  }
  shape.closePath();
  const bevel = detailed && !part.mortar ? .008 : 0;
  const indexed = new ExtrudeGeometry(shape, { bevelEnabled: bevel > 0, bevelSegments: 1,
    bevelSize: bevel, bevelThickness: bevel, depth: part.depth - bevel * 2, steps: 1, curveSegments: 1 });
  indexed.translate(part.position[0], part.position[1], part.position[2] - part.depth / 2 + bevel);
  const geometry = indexed.index ? indexed.toNonIndexed() : indexed;
  if (geometry !== indexed) indexed.dispose();
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let index = 0; index < colors.length; index++) colors[index] = part.tint[index % 3]!;
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
};

type DecorationPart = RoadDecorationRecipe["parts"][number];
/** Climber atlas cards and blooms batch into one indexed foliage mesh on the shared foliage material. */
const FOLIAGE = "foliage";
type DecorationSurface = BuildingSurface | typeof FOLIAGE;

const partGeometry = (part: DecorationPart, detailed: boolean): BufferGeometry => {
  if (!("kind" in part)) return createRomanPartGeometry(part, detailed);
  if (part.kind === "roman-column") return createRomanColumnGeometry(part.columnOrder ?? 0, detailed ? "high" : "minimal");
  if (part.kind === "arch-stone")
    return part.rubble === undefined ? archStoneGeometry(part, detailed) : createRoadRubbleGeometry(part, detailed);
  if (part.kind === "foliage-card" || part.kind === "rose-head") return createRoadFoliageGeometry(part);
  if (part.kind === "climber-stem") return createRoadClimberStemGeometry(part);
  if (part.kind === "folded-leaf" || part.kind === "botanical-leaf") return createRoadDecorationLeaf(part);
  if (part.kind === "wisteria-raceme") return createRoadDecorationRaceme(part, detailed);
  if (part.kind === "rubble-stone") return createRoadRubbleGeometry(part, detailed);
  return createRoadDecorationProfile(part, detailed);
};

const triangleCount = (geometry: BufferGeometry) =>
  (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;

/**
 * Static merged surfaces borrow their nation's existing maps/materials and the layer's shared
 * foliage material. This owner frees only its geometries (and its private stone materials).
 */
export const createRoadDecorationModel = (recipe: Omit<RoadDecorationRecipe, "definition"> &
  { definition: Pick<RoadDecorationRecipe["definition"], "id"> },
  materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean, foliage?: DecorationFoliageMaterials) => {
  const root = new Group(), groups = new Map<DecorationSurface, BufferGeometry[]>();
  const ownedMaterials: MeshStandardMaterial[] = [];
  root.name = `road_decoration_${recipe.definition.id}`;
  root.userData.roadDecoration = recipe.definition.id;
  for (const part of recipe.parts) {
    let geometry = partGeometry(part, detailed);
    // Foliage stays indexed (shared card vertices); every other surface merges flat as before.
    if (geometry.index && part.surface !== FOLIAGE) { const flat = geometry.toNonIndexed(); geometry.dispose(); geometry = flat; }
    if (recipe.stoneFamily && ["stone", "cut-stone", "plaster"].includes(part.surface) &&
      !("kind" in part && part.kind === "roman-column") &&
      !("kind" in part && part.kind === "arch-stone" && part.mortar))
      finishRoadDecorationStoneGeometry(geometry, detailed,
        !("kind" in part && part.kind === "arch-stone" && part.rubble !== undefined));
    geometry.clearGroups();
    // Imported primitive generators can carry shape-specific attributes; batching retains just shared channels.
    for (const key of Object.keys(geometry.attributes))
      if (!["position", "normal", "uv", "color"].includes(key)) geometry.deleteAttribute(key);
    const group = groups.get(part.surface) ?? [];
    group.push(geometry); groups.set(part.surface, group);
  }
  let triangles = 0;
  for (const [surface, geometries] of groups) {
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    if (!geometry) throw new Error(`Unable to batch road-decoration surface: ${surface}`);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    triangles += triangleCount(geometry);
    if (surface === FOLIAGE) {
      if (!foliage) throw new Error(`Road decoration foliage needs the shared foliage material: ${recipe.definition.id}`);
      const mesh = new Mesh(geometry, foliage.material);
      mesh.name = FOLIAGE; mesh.customDepthMaterial = foliage.depth; mesh.castShadow = detailed;
      mesh.receiveShadow = detailed;
      root.add(mesh);
      continue;
    }
    let material = materials[surface];
    if (recipe.stoneFamily && ["stone", "cut-stone", "plaster"].includes(surface)) {
      material = createRoadDecorationStoneMaterial(material, detailed, recipe.stoneFamily); ownedMaterials.push(material);
    }
    const mesh = new Mesh(geometry, material);
    mesh.name = surface; mesh.castShadow = detailed; mesh.receiveShadow = detailed;
    root.add(mesh);
  }
  const dispose = () => {
    root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    for (const material of ownedMaterials) material.dispose(); ownedMaterials.length = 0;
    root.clear(); root.removeFromParent();
  };
  return { root, triangles, dispose };
};

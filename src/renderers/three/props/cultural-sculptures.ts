import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { createPhoenixSculptureRecipe } from "../../../render-common/props/national-sculptures/phoenix-sculpture";
import { createQilinSculptureRecipe } from "../../../render-common/props/national-sculptures/qilin-sculpture";
import { SCULPTURE_MATERIALS } from "../../../render-common/props/national-sculptures/sculpture-materials";
import type { SculptureTier } from "../../../render-common/props/national-sculptures/sculpture-quality";
import type { SculptureGeometryRecipe, SculptureKind, SculptureMaterial, SculpturePart, SculptureRecipe }
  from "../../../render-common/props/national-sculptures/sculpture-recipe";
import { curveThrough, ellipsoid, loftGeometry, profileTube } from "../sculpt-geometry";
import { createSculptureAnatomyGeometry } from "./sculpture-anatomy-geometry";
import { createSculptureFeatherGeometry } from "./sculpture-feather";

const geometryFor = ({ shape, transforms }: SculptureGeometryRecipe): BufferGeometry => {
  let geometry: BufferGeometry;
  if (shape.kind === "anatomy") geometry = createSculptureAnatomyGeometry(shape);
  else if (shape.kind === "ellipsoid") geometry = ellipsoid(shape.segments, shape.scale, shape.position, shape.pitch);
  else if (shape.kind === "feather")
    geometry = createSculptureFeatherGeometry(shape.points, shape.width, shape.detailed, shape.contour);
  else if (shape.kind === "loft") geometry = loftGeometry(shape.rings, shape.sides);
  else geometry = profileTube(curveThrough(shape.points), t => {
    const index = Math.min(shape.segments, Math.max(0, t * shape.segments));
    const low = Math.floor(index), high = Math.min(shape.segments, low + 1);
    return shape.radii[low]! + (shape.radii[high]! - shape.radii[low]!) * (index - low);
  }, shape.segments, shape.sides);
  for (const { kind, values } of transforms) {
    if (kind === "translate") geometry.translate(values[0]!, values[1]!, values[2]!);
    else geometry[kind](values[0]!);
  }
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  return geometry;
};

const flame = [new Color("#8d1d15"), new Color("#ef6415"), new Color("#ffe074")];
const jade = [new Color("#14564c"), new Color("#279878"), new Color("#87dca1")];
const colorGeometry = (geometry: BufferGeometry, part: SculpturePart) => {
  if (!part.colorRamp) return;
  const uv = geometry.getAttribute("uv"), positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal"), colors = new Float32Array(positions.count * 3), color = new Color();
  const palette = part.colorRamp.startsWith("flame") ? flame : jade;
  for (let index = 0; index < positions.count; index++) {
    let t = Math.max(0, Math.min(1, uv.getY(index)));
    if (part.colorRamp === "flame-soft") t = .15 + t * .45;
    if (part.colorRamp === "jade") t = Math.max(.15, Math.min(.85, .5 + normals.getY(index) * .20 + normals.getZ(index) * .12));
    if (part.colorRamp === "jade-scale") t = .2 + t * .8;
    const half = t < .63 ? 0 : 1, blend = half ? (t - .63) / .37 : t / .63;
    color.copy(palette[half]!).lerp(palette[half + 1]!, blend);
    color.multiplyScalar(.94 + Math.sin(uv.getX(index) * Math.PI * 2) * .06);
    colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
};

/** Reusable baked geometry stream; consumers choose their batching and own every resulting geometry. */
export const appendSculptureGeometry = (recipe: SculptureRecipe,
  append: (name: string, material: SculptureMaterial, geometry: BufferGeometry) => void) => {
  for (const part of recipe.parts) {
    const geometry = geometryFor(part.geometry); colorGeometry(geometry, part);
    append(part.name, part.material, geometry);
  }
};

/** Original fine tool-mark/patina texture, generated locally and embedded by the standalone GLB exporter. */
const surfaceTexture = (feather = false) => {
  if (typeof document === "undefined") return undefined;
  const size = feather ? 128 : 64;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!, pixels = context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = (x * 73 + y * 37 + x * y * 11) % 17;
    const barb = Math.sin((y / size - Math.abs(Math.cos(x / size * Math.PI * 2)) * .12) * Math.PI * 90);
    const value = feather ? 196 + barb * 18 + grain * .3 : 188 + grain + Math.sin(x * .7 + y * .11) * 5;
    const offset = (y * size + x) * 4;
    pixels.data.set([value, value, value, 255], offset);
  }
  context.putImageData(pixels, 0, 0); const texture = new CanvasTexture(canvas); texture.needsUpdate = true;
  return texture;
};
export const createSculptureMaterials = (detailed = true) => {
  const texture = detailed ? surfaceTexture() : undefined;
  const feather = detailed ? surfaceTexture(true) : undefined;
  const materials = Object.fromEntries(Object.entries(SCULPTURE_MATERIALS).map(([name, definition]) => {
    const material = new MeshStandardMaterial(definition);
    const detail = name === "phoenixPlumage" ? feather : texture;
    if (detail) { material.roughnessMap = detail; material.bumpMap = detail; material.bumpScale = .0012; }
    return [name, material];
  })) as Record<SculptureMaterial, MeshStandardMaterial>;
  const disposeTextures = () => { texture?.dispose(); feather?.dispose(); };
  return { materials, disposeTextures, dispose: () => {
    Object.values(materials).forEach(material => material.dispose()); disposeTextures();
  } };
};

export const createCulturalSculpture = (kind: SculptureKind, detailed: boolean, batched = true, tier: SculptureTier = "hero") => {
  const recipe = kind === "phoenix" ? createPhoenixSculptureRecipe(detailed, tier) : createQilinSculptureRecipe(detailed, tier);
  const root = new Group(); root.name = `${kind}_sculpture`;
  const palette = createSculptureMaterials(detailed), geometries: BufferGeometry[] = [];
  appendSculptureGeometry(recipe, (name, material, geometry) => {
    geometries.push(geometry); const mesh = new Mesh(geometry, palette.materials[material]); mesh.name = name;
    mesh.castShadow = detailed; mesh.receiveShadow = true; root.add(mesh);
  });
  root.userData = { kind, mountOrigin: recipe.mountOrigin, authoredBounds: recipe.bounds };
  if (batched) {
    const groups = new Map<MeshStandardMaterial, BufferGeometry[]>();
    for (const child of root.children) {
      const mesh = child as Mesh, material = mesh.material as MeshStandardMaterial;
      const list = groups.get(material) ?? []; list.push(mesh.geometry); groups.set(material, list);
    }
    root.clear();
    for (const [material, pieces] of groups) {
      const indexed = pieces.every(piece => piece.index);
      const copies = pieces.map(piece => indexed || !piece.index ? piece.clone() : piece.toNonIndexed());
      const geometry = mergeGeometries(copies)!; copies.forEach(piece => piece.dispose());
      geometries.push(geometry); const mesh = new Mesh(geometry, material);
      mesh.name = `${kind}_${material.uuid}`; mesh.castShadow = detailed; mesh.receiveShadow = true; root.add(mesh);
    }
  }
  return { root, recipe, dispose: () => { geometries.forEach(geometry => geometry.dispose()); palette.dispose(); } };
};

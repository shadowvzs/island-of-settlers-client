import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial } from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

import { type SculptureAnatomy,sculptureAnatomyDistance } from "../../../render-common/props/national-sculptures/sculpture-anatomy";

const templates = new Map<string, BufferGeometry>();

/** A smoothly fused anatomical sculpture, with no intersecting sphere/cylinder neck seams. */
const buildAnatomy = (shape: SculptureAnatomy) => {
  const material = new MeshBasicMaterial();
  const field = new MarchingCubes(shape.resolution, material, false, false, 60000);
  field.isolation = 0;
  const resolution = shape.resolution;
  // MarchingCubes reserves three grid cells at every edge for gradient sampling. The working
  // field must include that padding; otherwise a perfectly valid muzzle is cut open at the border.
  const padding = shape.bounds.max.map((value, axis) =>
    (value - shape.bounds.min[axis]!) * 3 / (resolution - 6));
  const min = shape.bounds.min.map((value, axis) => value - padding[axis]!) as [number, number, number];
  const max = shape.bounds.max.map((value, axis) => value + padding[axis]!) as [number, number, number];
  const size = max.map((value, axis) => value - min[axis]!) as [number, number, number];
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++)
    for (let x = 0; x < resolution; x++) {
      const point = [x, y, z].map((value, axis) => min[axis]! + value / resolution * size[axis]!) as
        [number, number, number];
      field.field[x + y * resolution + z * resolution * resolution] = -sculptureAnatomyDistance(shape, ...point);
    }
  field.update();
  const count = field.count, geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(field.positionArray.slice(0, count * 3), 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(field.normalArray.slice(0, count * 3), 3));
  geometry.scale(size[0] / 2, size[1] / 2, size[2] / 2);
  geometry.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const positions = geometry.getAttribute("position"), uv = new Float32Array(count * 2);
  for (let vertex = 0; vertex < count; vertex++) {
    uv[vertex * 2] = .5 + Math.atan2(positions.getX(vertex), positions.getZ(vertex)) / (Math.PI * 2);
    uv[vertex * 2 + 1] = (positions.getY(vertex) - min[1]) / size[1];
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  field.geometry.dispose(); material.dispose();
  return geometry;
};

/** Bounded CPU templates avoid rebuilding an implicit surface for every ship; callers own their clone. */
export const createSculptureAnatomyGeometry = (shape: SculptureAnatomy) => {
  const key = JSON.stringify(shape);
  let geometry = templates.get(key);
  if (!geometry) {
    geometry = buildAnatomy(shape);
    if (templates.size >= 8) {
      const oldest = templates.keys().next().value!;
      templates.get(oldest)!.dispose(); templates.delete(oldest);
    }
    templates.set(key, geometry);
  }
  return geometry.clone();
};

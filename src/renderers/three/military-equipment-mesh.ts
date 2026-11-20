import {
  BufferGeometry,
  Color,
  type ColorRepresentation,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import { ATLAS_REGIONS, ATLAS_SIZE, type AtlasRegion } from "./military-equipment-atlas";

/**
 * Bakes equipment parts into one geometry for the shared equipment material: per-vertex colour,
 * metalness / roughness / livery dye (`equipmentSurface`) and UVs into the painted atlas. One
 * item is then one draw call, whatever the number of parts.
 */
export interface Finish {
  color: ColorRepresentation;
  /** 1 = dyed in the faction colour (the colour then shades the dye). */
  livery?: number;
  metal?: number;
  /** Planar XY projection of the part's bounds into a painted atlas region. */
  paint?: AtlasRegion;
  rough?: number;
  /** Map the part's own UVs into the wood grain (hafts, grips). */
  grain?: boolean;
}
export interface Placement {
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

export const METAL = { metal: .45, rough: .3 } as const;
export const MATTE = { metal: 0, rough: .78 } as const;

const color = new Color(), matrix = new Matrix4(), rotation = new Quaternion();
const position = new Vector3(), scale = new Vector3();

const regionUv = (region: AtlasRegion, u: number, v: number): [number, number] => {
  const [left, top, width, height] = ATLAS_REGIONS[region];
  return [(left + u * width) / ATLAS_SIZE, (top + v * height) / ATLAS_SIZE];
};

const bakeUvs = (geometry: BufferGeometry, finish: Finish) => {
  const positions = geometry.getAttribute("position"), count = positions.count;
  const source = geometry.getAttribute("uv"), uvs = new Float32Array(count * 2);
  geometry.computeBoundingBox();
  const { max, min } = geometry.boundingBox!;
  for (let index = 0; index < count; index++) {
    let uv: [number, number];
    if (finish.paint) {
      const u = (positions.getX(index) - min.x) / Math.max(1e-6, max.x - min.x);
      const v = (max.y - positions.getY(index)) / Math.max(1e-6, max.y - min.y);
      uv = regionUv(finish.paint, u, v);
    } else if (finish.grain && source) {
      uv = regionUv("wood", Math.min(1, source.getX(index)), Math.min(1, source.getY(index)));
    } else uv = regionUv("white", .5, .5);
    uvs.set(uv, index * 2);
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
};

const bakeSurface = (geometry: BufferGeometry, finish: Finish) => {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3), surface = new Float32Array(count * 3);
  color.set(finish.color);
  for (let index = 0; index < count; index++) {
    colors.set([color.r, color.g, color.b], index * 3);
    surface.set([finish.metal ?? MATTE.metal, finish.rough ?? MATTE.rough, finish.livery ?? 0], index * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("equipmentSurface", new Float32BufferAttribute(surface, 3));
};

const place = (geometry: BufferGeometry, placement: Placement) => {
  rotation.setFromEuler(new Euler(...(placement.rotation ?? [0, 0, 0])));
  position.fromArray(placement.position ?? [0, 0, 0]);
  scale.fromArray(placement.scale ?? [1, 1, 1]);
  geometry.applyMatrix4(matrix.compose(position, rotation, scale));
};

/** Collects parts (each with its own finish and placement) and merges them into one geometry. */
export const createEquipmentParts = () => {
  const parts: BufferGeometry[] = [];
  const bake = (part: BufferGeometry, finish: Finish, placement: Placement) => {
    for (const name of Object.keys(part.attributes))
      if (name !== "position" && name !== "normal" && name !== "uv") part.deleteAttribute(name);
    part.clearGroups();
    place(part, placement);
    bakeUvs(part, finish);
    bakeSurface(part, finish);
    parts.push(part);
  };
  /** Adds a part; an array of finishes follows the geometry's groups (e.g. extrude caps / sides). */
  const add = (geometry: BufferGeometry, finish: Finish | readonly Finish[], placement: Placement = {}) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    if (!Array.isArray(finish)) return bake(flat, finish as Finish, placement);
    const groups = flat.groups.length ? flat.groups : [{ count: Infinity, materialIndex: 0, start: 0 }];
    for (const group of groups) {
      const part = new BufferGeometry();
      for (const name of ["position", "normal", "uv"]) {
        const attribute = flat.getAttribute(name);
        if (!attribute) continue;
        const size = attribute.itemSize, end = Math.min(attribute.count, group.start + group.count);
        const values = (attribute.array as Float32Array).slice(group.start * size, end * size);
        part.setAttribute(name, new Float32BufferAttribute(values, size));
      }
      bake(part, finish[group.materialIndex ?? 0] ?? finish[0]!, placement);
    }
    flat.dispose();
  };
  const build = () => {
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    const indexed = mergeVertices(merged, 1e-5);
    merged.dispose();
    indexed.computeBoundingSphere();
    return indexed;
  };
  return { add, build };
};

/** Triangle count of a baked item (budgets and tests). */
export const countTriangles = (geometry: BufferGeometry) =>
  (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;

import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Float32BufferAttribute, Quaternion, TubeGeometry, Vector3
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { CampColor } from "../../../render-common/adventure/adventure-camp-style";

export type CampPoint = readonly [number, number, number];
export interface CampSurface {
  point(u: number, v: number): CampPoint;
  color(u: number, v: number): CampColor;
  freedom(u: number, v: number): number;
  columns?: number;
  rows?: number;
  fabric?: boolean;
}

/** Every part carries the same attributes so the complete camp can share a material/draw. */
export const createCampGeometryBuilder = (detailed: boolean, wood: CampColor, surfaceDensity = 1) => {
  const parts: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry, color: CampColor, x = 0, y = 0, z = 0) => {
    geometry.translate(x, y, z);
    if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count },
      (_value, index) => index));
    const vertices = geometry.getAttribute("position"), colors: number[] = [];
    for (let index = 0; index < vertices.count; index++) {
      const grain = detailed ? 1 + Math.sin(vertices.getY(index) * 73 + vertices.getX(index) * 37) * .035 : 1;
      colors.push(color[0] * grain, color[1] * grain, color[2] * grain);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    if (!geometry.getAttribute("campWind"))
      geometry.setAttribute("campWind", new Float32BufferAttribute(new Float32Array(vertices.count), 1));
    if (!geometry.getAttribute("campFabric"))
      geometry.setAttribute("campFabric", new Float32BufferAttribute(new Float32Array(vertices.count), 1));
    if (!geometry.getAttribute("campWood"))
      geometry.setAttribute("campWood", new Float32BufferAttribute(new Float32Array(vertices.count), 1));
    parts.push(geometry);
  };
  const pole = (from: CampPoint, to: CampPoint, radius = .04, color: CampColor = wood) => {
    const start = new Vector3(...from), end = new Vector3(...to);
    const delta = end.clone().sub(start), middle = start.add(end).multiplyScalar(.5);
    const geometry = new CylinderGeometry(radius * .86, radius, delta.length(), detailed ? 7 : 4);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()));
    add(geometry, color, middle.x, middle.y, middle.z);
  };
  const rope = (points: readonly CampPoint[], radius = .007, color: CampColor = wood) => {
    const path = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
    add(new TubeGeometry(path, detailed ? Math.max(6, points.length * 2) : Math.max(3, points.length), radius, 3, false), color);
  };
  const box = (size: CampPoint, center: CampPoint, color: CampColor = wood) =>
    add(detailed ? new RoundedBoxGeometry(...size, 1, Math.min(...size) * .08)
      : new BoxGeometry(...size), color, ...center);
  const surface = ({ color, columns = detailed ? 12 : 4, fabric = true, freedom, point, rows = detailed ? 12 : 4 }: CampSurface) => {
    columns = Math.max(2, Math.round(columns * surfaceDensity));
    rows = Math.max(2, Math.round(rows * surfaceDensity));
    const positions: number[] = [], colors: number[] = [], wind: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const u = column / columns, v = row / rows;
      positions.push(...point(u, v)); colors.push(...color(u, v));
      wind.push(freedom(u, v)); uv.push(u, v);
    }
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column, b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geometry = new BufferGeometry(); geometry.setIndex(indices);
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.setAttribute("campWind", new Float32BufferAttribute(wind, 1));
    geometry.setAttribute("campFabric", new Float32BufferAttribute(new Float32Array(wind.length).fill(fabric ? 1 : 0), 1));
    geometry.setAttribute("campWood", new Float32BufferAttribute(new Float32Array(wind.length), 1));
    geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals(); parts.push(geometry);
  };
  return { add, box, pole, rope, surface, finish: () => {
    const geometry = mergeGeometries(parts, false)!; parts.forEach(part => part.dispose());
    return geometry;
  } };
};
export type CampGeometryBuilder = ReturnType<typeof createCampGeometryBuilder>;

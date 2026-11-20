import { BufferGeometry, Float32BufferAttribute, SphereGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { ROMAN_ROOF_TILE_SCALE } from "../../../render-common/buildings/roman-roof-tiles";

type Point = [number, number, number];
const colorize = (geometry: BufferGeometry) => {
  geometry.setAttribute(
    "color",
    new Float32BufferAttribute(
      new Float32Array(geometry.getAttribute("position").count * 3).fill(1),
      3
    )
  );
  return geometry;
};

/** Individual convex clay pieces in latitude courses, over a continuous roof shell. */
export const createRomanDomeRoof = (detailed: boolean) => {
  if (!detailed) {
    const geometry = colorize(new SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const positions = geometry.getAttribute("position"),
      colors = geometry.getAttribute("color");
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const y = positions.getY(vertex),
        row = Math.round(Math.acos(Math.max(0, Math.min(1, y / 0.5))) / (Math.PI / 12));
      const factor = row % 2 ? 0.984 : 1;
      positions.setXYZ(
        vertex,
        positions.getX(vertex) * factor,
        y * factor,
        positions.getZ(vertex) * factor
      );
      const shade = row % 2 ? 0.975 : 1;
      colors.setXYZ(vertex, shade, shade, shade);
    }
    geometry.computeVertexNormals();
    return geometry;
  }
  const positions: number[] = [],
    colors: number[] = [],
    uv: number[] = [];
  const point = (azimuth: number, elevation: number, radius: number): Point => [
    Math.sin(azimuth) * Math.cos(elevation) * radius,
    Math.min(0.5, Math.sin(elevation) * radius),
    Math.cos(azimuth) * Math.cos(elevation) * radius
  ];
  const triangle = (a: Point, b: Point, c: Point, shade: number) => {
    positions.push(...a, ...b, ...c);
    for (const value of [a, b, c]) {
      colors.push(shade, shade, shade);
      uv.push(value[0] * 3 + 0.5, value[2] * 3 + 0.5);
    }
  };
  const rows = Math.ceil(8 / ROMAN_ROOF_TILE_SCALE);
  const courses = Array.from({ length: rows }, (_, row) =>
    Math.max(
      2,
      Math.round((22 / ROMAN_ROOF_TILE_SCALE) * Math.cos(((row + 0.5) * Math.PI) / (2 * rows)))
    )
  );
  courses.forEach((columns, row) => {
    const low = (row * Math.PI) / (2 * rows),
      high = ((row + 1) * Math.PI) / (2 * rows);
    for (let column = 0; column < columns; column++) {
      const phase = row % 2 ? 0.5 : 0;
      const left = ((column + phase) * Math.PI * 2) / columns + 0.003 * ROMAN_ROOF_TILE_SCALE;
      const right = ((column + 1 + phase) * Math.PI * 2) / columns - 0.003 * ROMAN_ROOF_TILE_SCALE;
      const bottom = Math.max(0, low - 0.009 * ROMAN_ROOF_TILE_SCALE),
        top = high;
      const outer = [
        point(left, bottom, 0.5 + 0.006 * ROMAN_ROOF_TILE_SCALE),
        point(right, bottom, 0.5 + 0.006 * ROMAN_ROOF_TILE_SCALE),
        point(right, top, 0.5),
        point(left, top, 0.5)
      ];
      const inner = [
        point(left, bottom, 0.5 - 0.015 * ROMAN_ROOF_TILE_SCALE),
        point(right, bottom, 0.5 - 0.015 * ROMAN_ROOF_TILE_SCALE),
        point(right, top, 0.5 - 0.015 * ROMAN_ROOF_TILE_SCALE),
        point(left, top, 0.5 - 0.015 * ROMAN_ROOF_TILE_SCALE)
      ];
      const shade = 0.99 + ((row * 7 + column * 3) % 5) * 0.003;
      triangle(outer[0]!, outer[1]!, outer[2]!, shade);
      triangle(outer[0]!, outer[2]!, outer[3]!, shade);
      // The downhill clay lap is exposed; the continuous shell covers buried side faces.
      triangle(outer[0]!, inner[0]!, inner[1]!, shade * 0.94);
      triangle(outer[0]!, inner[1]!, outer[1]!, shade * 0.94);
    }
  });
  const tiles = new BufferGeometry();
  tiles.setAttribute("position", new Float32BufferAttribute(positions, 3));
  tiles.setAttribute("color", new Float32BufferAttribute(colors, 3));
  tiles.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  tiles.computeVertexNormals();
  // Clay follows the dome curvature; hard normals belong only to the visible tile edges.
  const normals = tiles.getAttribute("normal"),
    vertices = tiles.getAttribute("position");
  for (let index = 0; index < vertices.count; index++)
    if (index % 12 < 6) {
      const x = vertices.getX(index),
        y = vertices.getY(index),
        z = vertices.getZ(index);
      const length = Math.hypot(x, y, z);
      normals.setXYZ(index, x / length, y / length, z / length);
    }
  const shell = colorize(
    new SphereGeometry(0.48, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  ).toNonIndexed();
  const geometry = mergeGeometries([shell, tiles])!;
  geometry.userData.roofTiles = courses.reduce((total, columns) => total + columns, 0);
  shell.dispose();
  tiles.dispose();
  return geometry;
};

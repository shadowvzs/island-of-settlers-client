import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute,
  Matrix4, Quaternion, Vector3
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { boatModelRecipe } from "../../../render-common/content/vessel-model-recipes";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { buildBargeHull } from "./harbour-barge-geometry";

const UP = new Vector3(0, 1, 0);
const colored = (geometry: BufferGeometry, hex: number) => {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const color = new Color(hex), values: number[] = [];
  for (let index = 0; index < flat.attributes.position!.count; index++) values.push(color.r, color.g, color.b);
  flat.setAttribute("color", new Float32BufferAttribute(values, 3));
  return flat;
};
const box = (position: [number, number, number], size: [number, number, number], hex: number) =>
  colored(new BoxGeometry(...size).translate(...position), hex);
const pole = (from: [number, number, number], to: [number, number, number], radius: number,
  hex: number, detailed: boolean, endRadius = radius) => {
  const start = new Vector3(...from), end = new Vector3(...to), direction = end.clone().sub(start);
  const rotation = new Quaternion().setFromUnitVectors(UP, direction.clone().normalize());
  const geometry = new CylinderGeometry(endRadius, radius, direction.length(), detailed ? 8 : 5);
  geometry.applyMatrix4(new Matrix4().compose(start.add(end).multiplyScalar(.5), rotation, new Vector3(1, 1, 1)));
  return colored(geometry, hex);
};
const merge = (parts: BufferGeometry[], name: string) => {
  const geometry = mergeGeometries(parts, false)!;
  parts.forEach(part => part.dispose());
  geometry.name = name;
  return geometry;
};
const reedWraps = (x: number, end: number) => Array.from({ length: 3 }, (_, wrap) =>
  box([x, .31 + wrap * .045, end * (1.06 + wrap * .02)], [.09, .016, .07], 0x705436));

/** Roman bronze-bound stem, Viking raised cutwaters, Nubian reed bundles, Japanese lashed transom. */
const nationalEnds = (nation: WorkerNation, detailed: boolean): BufferGeometry[] => {
  const parts: BufferGeometry[] = [];
  if (nation === "roman") {
    parts.push(pole([0, .18, 1.17], [0, .54, 1.22], .035, 0x927048, detailed));
    parts.push(box([0, .41, -1.20], [.31, .075, .06], 0xa88b54));
    for (const side of [-1, 1]) {
      parts.push(pole([side * .07, .34, 1.12], [side * .17, .40, .99], .018, 0xb29455, detailed));
      if (detailed) for (let index = 0; index < 4; index++)
        parts.push(box([side * .285, .29, -.75 + index * .40], [.035, .05, .09], 0x9f7846));
    }
    return parts;
  }
  if (nation === "viking") {
    for (const end of [-1, 1]) {
      const path = [[0, .25, end * 1.18], [0, .45, end * 1.23], [0, .64, end * 1.16],
        [0, .70, end * 1.04]] as [number, number, number][];
      for (let index = 1; index < path.length; index++)
        parts.push(pole(path[index - 1]!, path[index]!, .035 - index * .004, 0x624734, detailed));
      if (detailed) for (const side of [-1, 1])
        parts.push(box([side * .034, .53, end * 1.19], [.008, .075, .035], 0xc0a473));
    }
    return parts;
  }
  if (nation === "nubian") {
    for (const end of [-1, 1]) for (let bundle = -1; bundle <= 1; bundle++) {
      const x = bundle * .07;
      parts.push(pole([x, .20, end * 1.00], [x * .5, .57, end * 1.19], .041, 0xb69b5e, detailed, .019));
      parts.push(pole([x * .5, .57, end * 1.19], [x * .3, .66, end * 1.12], .019, 0xc6b17b, detailed, .012));
      if (detailed) parts.push(...reedWraps(x, end));
    }
    return parts;
  }
  for (const end of [-1, 1]) {
    parts.push(box([0, .40, end * 1.15], [.28, .16, .065], 0x866343));
    parts.push(box([0, .50, end * 1.15], [.35, .035, .085], 0x382d26));
    for (const side of [-1, 1]) {
      parts.push(pole([side * .13, .24, end * 1.07], [side * .13, .51, end * 1.15], .023, 0x705439, detailed));
      if (detailed) for (let wrap = 0; wrap < 3; wrap++)
        parts.push(box([side * .13, .38 + wrap * .028, end * 1.15], [.065, .012, .095], 0xc1ae83));
    }
  }
  return parts;
};

/** Shares the validated hull/oar envelope; fittings only change the ends above the load space. */
export const buildNationalShuttleHull = (nation: WorkerNation, detailed: boolean) => {
  const hull = merge([buildBargeHull(detailed, true), ...nationalEnds(nation, detailed)], `shuttle_hull_${nation}`);
  const position = hull.getAttribute("position"), uv: number[] = [];
  // Longitudinal mapping follows the strakes; all national fittings receive the same wood surface.
  for (let i = 0; i < position.count; i++) uv.push(position.getZ(i) * .42, position.getY(i) * 1.4 + position.getX(i) * .12);
  hull.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return hull;
};

/**
 * The hulls one boat layer draws, resolved through the boat's catalog model recipe (`boat:*` `model.recipe`) and
 * built once per nation: the shuttle lighter and the fishing skiff both draw the nation's harbour-boat hull.
 */
export const createNationalBoatHulls = (key: "fishingSkiff" | "lighter", detailed: boolean) => {
  const hulls = new Map<WorkerNation, BufferGeometry>();
  const hullFor = (nation: WorkerNation) => {
    const recipe = boatModelRecipe(key, nation);
    let hull = hulls.get(recipe.nation);
    if (hull) return hull;
    hull = buildNationalShuttleHull(recipe.nation, detailed);
    hulls.set(recipe.nation, hull);
    return hull;
  };
  const dispose = () => {
    hulls.forEach(hull => hull.dispose());
    hulls.clear();
  };
  return { dispose, hullFor };
};

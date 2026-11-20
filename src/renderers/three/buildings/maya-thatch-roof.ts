import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { MAYA_PLANT_ROOF_CORE_EDGE, MAYA_PLANT_ROOF_CORE_SCALE, MAYA_PLANT_ROOF_CORE_THICKNESS,
  MAYA_PLANT_ROOF_STYLES, insideMayaRoofPlanCut, mayaPlantRoofProfileHeight }
  from "../../../render-common/buildings/maya-plant-roof-profile";
import {
  ACROSS_SLOPE, getEndSlope, HIP_RIDGE_END,
  isHippedOccupationRoof,
} from "../../../render-common/buildings/occupation-roof-height";

const CORE_SCALE = MAYA_PLANT_ROOF_CORE_SCALE;
// The opaque weatherproof shell ends behind the loose bundles, never at the visible straw tips.
const CORE_EDGE = MAYA_PLANT_ROOF_CORE_EDGE;
const random = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const clamp = (value: number) => Math.max(-.499, Math.min(.499, value));
const strandCentre = (value: number) => Math.max(-.4975, Math.min(.4975, value));
type RoofBoundaryEdge = readonly [number, number, number, number, "side" | "end" | null];

/** Thick thatch with closed bent straw blades over an opaque, atlas-covered core. */
export const createMayaThatchRoof = (part: BuildingPart, detailed: boolean) => {
  const style = part.plantRoofStyle ?? "maize", plant = MAYA_PLANT_ROOF_STYLES[style];
  const positions: number[] = [], colours: number[] = [], uvs: number[] = [];
  const hip = isHippedOccupationRoof(part.occupationRoof), cuts = part.roofPlanCuts ?? [];
  const vertex = (point: Vector3, shade: number, end: boolean, eave: boolean) => {
    positions.push(point.x, point.y, point.z); colours.push(shade, shade, shade);
    if (eave) uvs.push((end ? point.x + .5 : point.z + .5) * part.size[end ? 0 : 2],
      (point.y + .5) * part.size[1]);
    else if (end) uvs.push((point.x + .5) * part.size[0], Math.abs(point.z) * part.size[2]);
    else uvs.push((point.z + .5) * part.size[2], Math.abs(point.x) * part.size[0]);
  };
  const insideCut = (point: Vector3) =>
    cuts.some(cut => insideMayaRoofPlanCut(cut, point.x, point.z));
  /** Push any plan point inside a tower drum out to its cut ellipse; the wall hides the seam. */
  const outsideCutPlan = (x: number, z: number): [number, number] => {
    let px = x, pz = z;
    for (const cut of cuts) {
      const dx = (px - cut.x) / cut.radiusX, dz = (pz - cut.z) / cut.radiusZ;
      const distance = Math.hypot(dx, dz);
      if (distance >= 1) continue;
      if (distance < 1e-9) { px = cut.x + cut.radiusX; pz = cut.z; continue; }
      px = cut.x + dx / distance * cut.radiusX;
      pz = cut.z + dz / distance * cut.radiusZ;
    }
    return [px, pz];
  };
  const edgeCrossesCut = (from: Vector3, to: Vector3) => {
    for (let step = 0; step <= 4; step++) {
      const t = step / 4;
      const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
      if (cuts.some(cut => insideMayaRoofPlanCut(cut, x, z))) return true;
    }
    return false;
  };
  const triangle = (a: Vector3, b: Vector3, c: Vector3, shade: number, end: boolean,
    outward?: Vector3, eave = false) => {
    // Drop every shell/fibre triangle that reaches the drum. The masonry hides the resulting
    // hole; a triangle that only crosses the cut would otherwise leave a bundle on the tower.
    if (insideCut(a) || insideCut(b) || insideCut(c) ||
      edgeCrossesCut(a, b) || edgeCrossesCut(b, c) || edgeCrossesCut(c, a)) return;
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq() < 1e-16) return;
    if (outward && normal.dot(outward) < 0) [b, c] = [c, b];
    for (const point of [a, b, c]) vertex(point, shade, end, eave);
  };
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, shade: number, end = false, eave = false) => {
    triangle(a, c, b, shade, end, undefined, eave); triangle(a, d, c, shade, end, undefined, eave);
  };
  const surface = (x: number, z: number, lift = 0) => {
    const [cutX, cutZ] = outsideCutPlan(x, z);
    const px = Math.max(-.5, Math.min(.5, cutX)), pz = Math.max(-.5, Math.min(.5, cutZ));
    const overshoot = Math.max(0, Math.abs(x) - .5, Math.abs(z) - .5);
    return new Vector3(strandCentre(cutX * CORE_SCALE),
      clamp(mayaPlantRoofProfileHeight(part, px, pz) + lift - overshoot * 1.3),
      strandCentre(cutZ * CORE_SCALE));
  };
  const at = (x: number, t: number) => {
    let z = t;
    if (hip) {
      const reach = Math.min(CORE_EDGE, HIP_RIDGE_END + Math.abs(x) * ACROSS_SLOPE / getEndSlope(part.occupationRoof));
      z = Math.sign(t) * (Math.abs(t) <= HIP_RIDGE_END ? Math.abs(t) * reach / HIP_RIDGE_END
        : reach + (Math.abs(t) - HIP_RIDGE_END) / (CORE_EDGE - HIP_RIDGE_END) * (CORE_EDGE - reach));
    }
    return surface(x, z);
  };
  // A coarse closed shell releases hidden grid triangles for individual real surface strands.
  const rows = detailed ? 4 : 2, columns = detailed ? 4 : 2;
  const halfHipHinge = (CORE_EDGE - HIP_RIDGE_END) * getEndSlope(part.occupationRoof) / ACROSS_SLOPE;
  const xs = [...new Set([...Array.from({ length: rows + 1 }, (_, index) => (index / rows * 2 - 1) * CORE_EDGE),
    -Math.min(CORE_EDGE, halfHipHinge), Math.min(CORE_EDGE, halfHipHinge)])].sort((a, b) => a - b);
  const ts = [...new Set([...Array.from({ length: columns + 1 }, (_, index) => (index / columns * 2 - 1) * CORE_EDGE),
    -HIP_RIDGE_END, HIP_RIDGE_END])].sort((a, b) => a - b);
  const rimSegments = detailed ? 8 : 3;
  const below = (x: number, t: number) => {
    const point = at(x, t), edge = Math.max(Math.abs(point.x), Math.abs(point.z)) > CORE_SCALE * CORE_EDGE - 1e-7;
    const wave = Math.sin(point.x * 131 + point.z * 197) * .58
      + Math.sin(point.x * 271 - point.z * 83) * .42;
    point.y -= edge ? MAYA_PLANT_ROOF_CORE_THICKNESS + .002 + Math.max(-.008, wave * .08) : MAYA_PLANT_ROOF_CORE_THICKNESS;
    return point;
  };
  const rim = (x0: number, t0: number, x1: number, t1: number, end: boolean) => {
    for (let segment = 0; segment < rimSegments; segment++) {
      const a = segment / rimSegments, b = (segment + 1) / rimSegments;
      const ax = x0 + (x1 - x0) * a, az = t0 + (t1 - t0) * a;
      const bx = x0 + (x1 - x0) * b, bz = t0 + (t1 - t0) * b;
      quad(at(ax, az), at(bx, bz), below(bx, bz), below(ax, az), .96, end, true);
    }
  };
  const boundaryBottom = (edges: readonly RoofBoundaryEdge[], x: number, t: number, end: boolean) => {
    const polygon: Vector3[] = [];
    for (const [ax, az, bx, bz, outer] of edges) {
      const count = outer !== null ? rimSegments : 1;
      for (let step = 0; step < count; step++)
        polygon.push(below(ax + (bx - ax) * step / count, az + (bz - az) * step / count));
    }
    const centre = below(x, t);
    for (let at = 0; at < polygon.length; at++)
      triangle(centre, polygon[at]!, polygon[(at + 1) % polygon.length]!, .89, end);
  };
  const physicalEdge = (a: Vector3, b: Vector3): RoofBoundaryEdge[4] => {
    if (Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.x) > CORE_SCALE * CORE_EDGE - 1e-7) return "side";
    if (Math.abs(a.z - b.z) < 1e-7 && Math.abs(a.z) > CORE_SCALE * CORE_EDGE - 1e-7) return "end";
    return null;
  };
  for (let row = 0; row < xs.length - 1; row++) for (let column = 0; column < ts.length - 1; column++) {
    const x0 = xs[row]!, x1 = xs[row + 1]!, t0 = ts[column]!, t1 = ts[column + 1]!;
    const end = hip && Math.abs((t0 + t1) / 2) > HIP_RIDGE_END;
    const a = at(x0, t0), b = at(x1, t0), c = at(x1, t1), d = at(x0, t1);
    const planArea = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))
      + Math.abs((c.x - a.x) * (d.z - a.z) - (c.z - a.z) * (d.x - a.x));
    // Half-hip end cells collapse onto the eave after the end plane meets the side pitch.
    // They have no roof area; emitting a noisy soffit there creates vertical paper fragments.
    if (planArea < 1e-12) continue;
    quad(a, b, c, d, .99, end);
    const edges: RoofBoundaryEdge[] = [
      [x0, t0, x1, t0, physicalEdge(a, b)], [x1, t0, x1, t1, physicalEdge(b, c)],
      [x1, t1, x0, t1, physicalEdge(c, d)], [x0, t1, x0, t0, physicalEdge(d, a)],
    ];
    const boundary = edges.some(edge => edge[4] !== null);
    if (!boundary) quad(below(x0, t1), below(x1, t1), below(x1, t0), below(x0, t0), .89, end);
    else boundaryBottom(edges, (x0 + x1) / 2, (t0 + t1) / 2, end);
    for (const [ax, az, bx, bz, edge] of edges)
      if (edge !== null) rim(bx, bz, ax, az, edge === "end");
  }
  const coreVertices = positions.length / 3;
  const downhill = (x: number, z: number) => {
    const across = .43 - ACROSS_SLOPE * Math.abs(x);
    const end = .43 - getEndSlope(part.occupationRoof) * Math.max(0, Math.abs(z) - HIP_RIDGE_END);
    if ((hip && end < across) || (part.occupationRoof === "pyramid" && Math.abs(z) > Math.abs(x)))
      return { direction: new Vector3(0, 0, Math.sign(z) || 1), end: true };
    return { direction: new Vector3(Math.sign(x) || 1, 0, 0), end: false };
  };
  const density = part.compactGeometry ? .2 : 1;
  const fringeCount = Math.ceil((detailed ? plant.fringeHigh : plant.fringeMin) * density);
  const fibre = (x: number, z: number, seed: number, fringe = false, forced?: Vector3) => {
    const pitch = downhill(x, z), flow = forced ?? pitch.direction;
    const across = new Vector3(-flow.z, 0, flow.x).normalize();
    const length = fringe ? .035 + seed * .045 : plant.length + seed * plant.lengthRange;
    let width = plant.width + random(seed * 83) ** 2 * plant.widthRange;
    if (fringe && style !== "palm") width = .004 + random(seed * 83) * .006;
    let segments = detailed ? plant.segments : plant.segmentsMin;
    if (fringe && detailed) segments = 2;
    const rings: Vector3[][] = [], centres: Vector3[] = [];
    for (let row = 0; row <= segments; row++) {
      const t = row / segments, drift = Math.sin(seed * 17 + t * 2) * (style === "reed" ? .001 : .009) * t;
      const px = x + flow.x * length * t + across.x * drift;
      const pz = z + flow.z * length * t + across.z * drift;
      // A strand crossing the drum would reappear on the far side: omit it whole, as thatch would
      // be packed against the masonry instead of pushed through it.
      if (cuts.some(cut => insideMayaRoofPlanCut(cut, px, pz))) return;
      const bend = row === 0 ? -(detailed ? .01 : .016)
        : Math.sin(t * Math.PI * .7) * (plant.arc + seed * plant.arc * .7);
      const hang = fringe ? t * t * (.105 + seed * .05) : 0;
      const point = surface(px, pz, bend - hang);
      const ahead = surface(px + flow.x * .003, pz + flow.z * .003);
      const slope = ahead.sub(surface(px, pz)).normalize();
      const normal = across.clone().cross(slope).normalize();
      let taper = 1;
      if (style === "palm") taper = .06 + Math.sin(t * Math.PI) * .94;
      else if (row === 0) taper = .55;
      else if (row === segments) taper = .12;
      const ring = [point.clone().addScaledVector(across, width * taper),
        point.clone().addScaledVector(across, -width * taper),
        point.clone().addScaledVector(normal, width * taper * .85)];
      ring.forEach(point => point.set(clamp(point.x), clamp(point.y), clamp(point.z)));
      rings.push(ring);
      centres.push(ring.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(3));
    }
    // The centre line is outside, but a wide fibre's flank can still brush the drum.
    if (rings.some(ring => ring.some(point => insideCut(point)))) return;
    const shade = .94 + seed * .09;
    for (let row = 0; row < segments; row++) for (let side = 0; side < 3; side++) {
      const a = rings[row]![side]!, b = rings[row + 1]![side]!;
      const c = rings[row + 1]![(side + 1) % 3]!, d = rings[row]![(side + 1) % 3]!;
      const centre = centres[row]!.clone().lerp(centres[row + 1]!, .5);
      const outward = a.clone().add(b).add(c).add(d).multiplyScalar(.25).sub(centre);
      triangle(a, b, c, shade, pitch.end, outward); triangle(a, c, d, shade, pitch.end, outward);
    }
    triangle(rings[0]![0]!, rings[0]![1]!, rings[0]![2]!, shade, pitch.end,
      centres[0]!.clone().sub(centres[1]!));
    triangle(rings.at(-1)![0]!, rings.at(-1)![1]!, rings.at(-1)![2]!, shade, pitch.end,
      centres.at(-1)!.clone().sub(centres.at(-2)!));
  };
  const field = Math.ceil((detailed ? plant.fieldHigh : plant.fieldMin) * density);
  for (let index = 0; index < field; index++) {
    const clumpSize = style === "palm" ? 5 : 3;
    const clump = detailed ? Math.floor(index / clumpSize) : index;
    const x = ((clump * .754877666 + .173) % 1 - .5) * .91 + (random(index + 71) - .5) * .02;
    const z = ((clump * .569840291 + .317) % 1 - .5) * .91 + (random(index + 94) - .5) * .02;
    let direction: Vector3 | undefined;
    if (style === "palm") {
      const flow = downhill(x, z).direction, turn = ((index % 5) - 2) * .22;
      direction = new Vector3(flow.x * Math.cos(turn) - flow.z * Math.sin(turn), 0,
        flow.x * Math.sin(turn) + flow.z * Math.cos(turn));
    }
    fibre(x, z, random(index + 11), false, direction);
  }
  for (let index = 0; index < fringeCount; index++) {
    const edge = index % 4, t = (Math.floor(index / 4) + random(index + 129)) / Math.ceil(fringeCount / 4);
    const along = -.465 + t * .93, sign = edge % 2 ? 1 : -1;
    const x = edge < 2 ? sign * .455 : along, z = edge < 2 ? along : sign * .455;
    fibre(x, z, random(index + 513), true, new Vector3(edge < 2 ? sign : 0, 0, edge < 2 ? 0 : sign));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.userData.thatch = { plantRoofStyle: style, strands: field + fringeCount, fieldStrands: field, eaveStrands: fringeCount,
    coreVertices, opaqueCore: true, alphaCards: false };
  return geometry;
};

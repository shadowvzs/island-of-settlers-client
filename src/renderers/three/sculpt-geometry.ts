import {
  BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, SphereGeometry, TubeGeometry, Vector3
} from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type SculptPoint = readonly [number, number, number];
export type SculptColor = readonly [number, number, number];

/** Tube along `curve` whose radius follows `radiusAt(t)` (muscle bulges, cuffs, tapering limbs). */
export const profileTube = (curve: CatmullRomCurve3, radiusAt: (t: number) => number, segments: number,
  sides: number) => {
  const geometry = new TubeGeometry(curve, segments, 1, sides);
  const position = geometry.getAttribute("position"), centre = new Vector3(), vertex = new Vector3();
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments;
    curve.getPointAt(t, centre);
    const radius = radiusAt(t);
    for (let side = 0; side <= sides; side++) {
      const index = ring * (sides + 1) + side;
      vertex.fromBufferAttribute(position, index).sub(centre).multiplyScalar(radius).add(centre);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** Tube along `curve` whose radius tapers from `start` to `end` (closed by the parts it joins). */
export const taperedTube = (curve: CatmullRomCurve3, start: number, end: number, segments: number, sides: number) =>
  profileTube(curve, t => start + (end - start) * t, segments, sides);

export const curveThrough = (points: readonly SculptPoint[]) =>
  new CatmullRomCurve3(points.map(point => new Vector3(...point)));

/** Unit sphere scaled to `scale`, pitched about x and moved to `position`. */
export const ellipsoid = (segments: number, scale: SculptPoint, position: SculptPoint, pitch = 0) =>
  new SphereGeometry(1, segments, Math.max(3, segments - 2)).scale(...scale).rotateX(pitch).translate(...position);

/** A lofted cross-section: height, half width and half depth, with an optional centre offset. */
export interface SculptRing { y: number; rx: number; rz: number; x?: number; z?: number }
export interface LoftOptions {
  /** Partial loft between these angles (0 faces +z, increasing towards +x), e.g. a cloak's back. */
  arc?: readonly [number, number];
  caps?: boolean;
  /** Radial relief, e.g. drapery folds: multiplies both radii at an angle and height. */
  relief?: (angle: number, y: number) => number;
}

const loftPoint = (ring: SculptRing, side: number, sides: number, options: LoftOptions): SculptPoint => {
  const [from, to] = options.arc ?? [0, Math.PI * 2], angle = from + (to - from) * side / sides;
  const relief = options.relief?.(angle, ring.y) ?? 1;
  return [(ring.x ?? 0) + Math.sin(angle) * ring.rx * relief, ring.y,
    (ring.z ?? 0) + Math.cos(angle) * ring.rz * relief];
};

const positionGeometry = (positions: number[], uv?: number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (uv) geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return geometry;
};

/**
 * Elliptical rings stacked upwards and skinned; closed with flat caps unless it is an arc. UVs run
 * round the loft (u, seam-free from 0 to 1) and up it (v, by ring); caps take the centre of the map.
 */
export const loftGeometry = (rings: readonly SculptRing[], sides: number, options: LoftOptions = {}, inward = false) => {
  const positions: number[] = [], uv: number[] = [];
  const corner = (row: number, side: number) => ({ point: loftPoint(rings[row]!, side, sides, options),
    uv: [side / sides, row / Math.max(1, rings.length - 1)] as const });
  type Corner = ReturnType<typeof corner>;
  const triangle = (a: Corner, b: Corner, c: Corner) => {
    for (const vertex of inward ? [a, c, b] : [a, b, c]) { positions.push(...vertex.point); uv.push(...vertex.uv); }
  };
  for (let row = 0; row < rings.length - 1; row++) for (let side = 0; side < sides; side++) {
    const a = corner(row, side), b = corner(row, side + 1), c = corner(row + 1, side + 1), d = corner(row + 1, side);
    triangle(a, b, c); triangle(a, c, d);
  }
  if (options.caps ?? !options.arc) for (const end of [0, rings.length - 1]) {
    const ring = rings[end]!, centre = { point: [ring.x ?? 0, ring.y, ring.z ?? 0] as SculptPoint, uv: [.5, .5] as const };
    for (let side = 0; side < sides; side++) {
      if (end === 0) triangle(centre, corner(end, side + 1), corner(end, side));
      else triangle(centre, corner(end, side), corner(end, side + 1));
    }
  }
  return positionGeometry(positions, uv);
};

/** A thin draped sheet: the outer loft, its inner face (facing inwards) and the two side edges. */
export const shellGeometry = (rings: readonly SculptRing[], sides: number, thickness: number,
  options: LoftOptions & { arc: readonly [number, number] }) => {
  const inner = rings.map(ring => ({ ...ring, rx: ring.rx - thickness, rz: ring.rz - thickness }));
  const edges: number[] = [];
  for (const side of [0, sides]) for (let row = 0; row < rings.length - 1; row++) {
    const a = loftPoint(rings[row]!, side, sides, options), b = loftPoint(rings[row + 1]!, side, sides, options);
    const c = loftPoint(inner[row + 1]!, side, sides, options), d = loftPoint(inner[row]!, side, sides, options);
    edges.push(...(side === 0 ? [a, b, c, a, c, d] : [a, d, c, a, c, b]).flat());
  }
  return [loftGeometry(rings, sides, options), loftGeometry(inner, sides, options, true),
    positionGeometry(edges, new Array<number>(edges.length / 3 * 2).fill(.5))];
};

export interface SculptBox { max: SculptPoint; min: SculptPoint }

/**
 * Maps a geometry's bounds (or a fixed authoring box shared by both detail levels) onto the unit
 * recipe box (-0.5…0.5 on every axis).
 */
export const fitUnitBox = <T extends BufferGeometry>(geometry: T, box?: SculptBox) => {
  geometry.computeBoundingBox();
  const max = box ? new Vector3(...box.max) : geometry.boundingBox!.max.clone();
  const min = box ? new Vector3(...box.min) : geometry.boundingBox!.min.clone();
  const centre = max.clone().add(min).multiplyScalar(.5), size = max.clone().sub(min);
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.computeBoundingBox();
  /** Authored proportions: recipe sizes must keep this aspect to avoid stretching the form. */
  geometry.userData.sourceSize = size.toArray();
  return geometry;
};

/** Palettes are authored as display (sRGB) colours; vertex colours are linear. */
const linear = (color: SculptColor): SculptColor => [color[0] ** 2.2, color[1] ** 2.2, color[2] ** 2.2];

/**
 * Vertex normals averaged over every vertex sharing a position and colour, so UV seams (a loft's
 * back seam, atlas borders) do not show as creases; colour borders stay crisp.
 */
const smoothAcrossUvSeams = (geometry: BufferGeometry) => {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position"), color = geometry.getAttribute("color");
  const normal = geometry.getAttribute("normal"), groups = new Map<string, number[]>();
  for (let index = 0; index < position.count; index++) {
    const key = [position.getX(index), position.getY(index), position.getZ(index), color.getX(index),
      color.getY(index), color.getZ(index)].map(value => Math.round(value * 1e5)).join(",");
    const group = groups.get(key);
    if (group) group.push(index); else groups.set(key, [index]);
  }
  const sum = new Vector3(), part = new Vector3();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    sum.set(0, 0, 0);
    for (const index of group) sum.add(part.fromBufferAttribute(normal, index));
    sum.normalize();
    for (const index of group) normal.setXYZ(index, sum.x, sum.y, sum.z);
  }
};

/** A rectangle of a detail atlas (u0, v0, u1, v1) that a part's own 0…1 UVs are mapped into. */
export type AtlasRect = readonly [number, number, number, number];
type Paint = SculptColor | ((point: Vector3) => SculptColor);

/**
 * Collects coloured triangles from several geometries into one vertex-coloured sculpt, so a whole
 * painted figure or ornament is a single shared batch. Seams between colours stay crisp. Parts given
 * an atlas rectangle keep their own UVs inside it (chainmail, knotwork); the others are projected.
 */
export const createColouredSculpt = () => {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [];
  const vertex = new Vector3();
  const add = (geometry: BufferGeometry, color: Paint, rect?: AtlasRect) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = flat.getAttribute("position"), uv = flat.getAttribute("uv"), centroid = new Vector3();
    for (let index = 0; index < position.count; index += 3) {
      centroid.set(0, 0, 0);
      for (let corner = 0; corner < 3; corner++) centroid.add(vertex.fromBufferAttribute(position, index + corner));
      const tint = linear(typeof color === "function" ? color(centroid.divideScalar(3)) : color);
      for (let corner = 0; corner < 3; corner++) {
        vertex.fromBufferAttribute(position, index + corner);
        positions.push(vertex.x, vertex.y, vertex.z);
        colors.push(...tint);
        if (!rect || !uv) uvs.push(Number.NaN, Number.NaN);
        else uvs.push(rect[0] + (rect[2] - rect[0]) * uv.getX(index + corner),
          rect[1] + (rect[3] - rect[1]) * uv.getY(index + corner));
      }
    }
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  };
  const finish = (geometry: BufferGeometry, plainRect: AtlasRect) => {
    const position = geometry.getAttribute("position");
    for (let index = 0; index < position.count; index++) {
      if (!Number.isNaN(uvs[index * 2]!)) continue;
      uvs[index * 2] = plainRect[0] + (plainRect[2] - plainRect[0]) * (position.getX(index) + .5);
      uvs[index * 2 + 1] = plainRect[1] + (plainRect[3] - plainRect[1]) * (position.getY(index) + .5);
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    const sculpt = mergeVertices(geometry, .00001);
    smoothAcrossUvSeams(sculpt);
    sculpt.userData.sourceSize = geometry.userData.sourceSize;
    geometry.dispose();
    return sculpt;
  };
  const collected = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return geometry;
  };
  /** One geometry, fitted to the unit box, with smooth normals inside each colour region. */
  const build = (box?: SculptBox, plainRect: AtlasRect = [0, 0, 1, 1]) =>
    finish(fitUnitBox(collected(), box), plainRect);
  /** The same, left where it was modelled (ship ornaments built in ship space). */
  const buildInPlace = () => finish(collected(), [0, 0, 1, 1]);
  return { add, build, buildInPlace };
};

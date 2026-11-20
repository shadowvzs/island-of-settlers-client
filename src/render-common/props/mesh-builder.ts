import type { Random } from "../../shared/world/rng";

export type Vec3 = readonly [number, number, number];

/**
 * A small static mesh in prop space (y up, base at the origin, one unit = one cell).
 * wind: x = bend weight (0 at the ground .. 1 at the top), y = flutter weight (leaves).
 * uvs: position in the leaf atlas, NO_UV (-1) for untextured vertices.
 */
export interface PropMesh {
  /** False keeps the kind out of the sun-depth pass (low cover such as shade grass). */
  castsShadow?: boolean;
  colors: Float32Array;
  /** Radius of the dark root zone under a plant (contact shadow decal). */
  contactRadius?: number;
  /** LOD: the first coreIndexCount indices draw the simplified plant (all when unset). */
  coreIndexCount?: number;
  height: number;
  indices: Uint16Array;
  /**
   * Separate authored minimal-LOD triangles over the same vertex buffer (the biome grasses):
   * the far/zoom-out draw uses these instead of the full indices. Distinct from minimalIndices,
   * which is the cheap dynamic mesh of growing/falling source assets.
   */
  lodMinimalIndices?: Uint16Array;
  /** Optional cheap dynamic mesh indices for growing/falling high-detail source assets. */
  minimalIndices?: Uint16Array;
  normals: Float32Array;
  positions: Float32Array;
  radius: number;
  uvs: Float32Array;
  wind: Float32Array;
}

export type Vec2 = readonly [number, number];

export const NO_UV: Vec2 = [-1, -1];
/**
 * An untextured deciduous leaf (vertex colour, plain prop light like NO_UV) that follows the GPU season tint
 * (season-glsl.ts: it turns in autumn and drops when dormant). Between NO_UV and the hardwood-leaf sentinel.
 */
export const SEASONAL_LEAF_UV: Vec2 = [-1.05, -1];
/** The u range the shaders read as SEASONAL_LEAF_UV (exclusive). */
export const SEASONAL_LEAF_U_RANGE = [-1.09, -1.01] as const;

type ColorAt = (position: Vec3, normal: Vec3) => Vec3;

/** Explicit wind of a plant vertex: path length from the root along the stems, leaf flutter. */
export interface VertexWind {
  flutter: number;
  path: number;
}

export interface FinishOptions {
  contactRadius?: number;
  /** Plant flexibility: bend weight at the outermost tip (woody shrubs low, reeds high). */
  flex?: number;
}

/** Vertex without a stem path: bends by its height (trees, rocks). */
export const NO_PATH = -1;

export interface VertexStyle {
  color: ColorAt;
  /** Leaves flutter, trunks and rocks do not. */
  flutter: number;
}

/** Collects vertices and triangles; finish() turns them into typed arrays. */
export class MeshBuilder {
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly normals: number[] = [];
  private readonly positions: number[] = [];
  private readonly detailIndices: number[] = [];
  private readonly flutter: number[] = [];
  private readonly paths: number[] = [];
  private readonly uvs: number[] = [];
  /** Triangles added while true are LOD detail: dropped by the simplified (core) draw range. */
  detail = false;

  get vertexCount() {
    return this.positions.length / 3;
  }

  addVertex(position: Vec3, normal: Vec3, style: VertexStyle, uv: Vec2 = NO_UV, wind?: VertexWind) {
    this.positions.push(...position);
    this.uvs.push(...uv);
    this.normals.push(...normal);
    this.colors.push(...style.color(position, normal));
    this.flutter.push(wind ? wind.flutter : style.flutter);
    this.paths.push(wind ? wind.path : NO_PATH);
    return this.vertexCount - 1;
  }

  addTriangle(a: number, b: number, c: number) {
    (this.detail ? this.detailIndices : this.indices).push(a, b, c);
  }

  /**
   * Bend weight: plant vertices with a stem path bend with (path / longest path)^1.5 times the
   * plant's flex (root anchored, tips move most, leaves follow their twig); other vertices use
   * height squared, so trunks stay rooted and tops sway.
   */
  private createWind(height: number, flex: number) {
    const longest = this.paths.reduce((max, path) => Math.max(max, path), 0.01);
    const wind = new Float32Array(this.vertexCount * 2);
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) {
      const path = this.paths[vertex]!;
      const relative = Math.max(0, this.positions[vertex * 3 + 1]! / height);
      wind[vertex * 2] =
        path === NO_PATH ? relative * relative : flex * Math.pow(Math.max(0, Math.min(1, path / longest)), 1.5);
      wind[vertex * 2 + 1] = this.flutter[vertex]!;
    }
    return wind;
  }

  finish(options: FinishOptions = {}): PropMesh {
    let height = 0.01;
    let radius = 0.01;
    for (let index = 0; index < this.positions.length; index += 3) {
      height = Math.max(height, this.positions[index + 1]!);
      radius = Math.max(radius, Math.hypot(this.positions[index]!, this.positions[index + 2]!));
    }
    const hasDetail = this.detailIndices.length > 0;
    return {
      colors: Float32Array.from(this.colors),
      contactRadius: options.contactRadius,
      coreIndexCount: hasDetail ? this.indices.length : undefined,
      height,
      indices: Uint16Array.from([...this.indices, ...this.detailIndices]),
      normals: Float32Array.from(this.normals),
      positions: Float32Array.from(this.positions),
      radius,
      uvs: Float32Array.from(this.uvs),
      wind: this.createWind(height, options.flex ?? 1)
    };
  }
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];

export const normalize = (vector: Vec3): Vec3 => {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

/** Open cylinder / cone frustum around the y axis (trunks, stems, cone layers). */
export const addFrustum = (
  builder: MeshBuilder,
  base: Vec3,
  height: number,
  radii: [number, number],
  segments: number,
  style: VertexStyle
) => {
  const [bottom, top] = radii;
  const slope = (bottom - top) / height;
  const first = builder.vertexCount;
  for (let segment = 0; segment <= segments; segment += 1) {
    const angle = (segment / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const normal = normalize([cos, slope, sin]);
    builder.addVertex([base[0] + cos * bottom, base[1], base[2] + sin * bottom], normal, style);
    builder.addVertex([base[0] + cos * top, base[1] + height, base[2] + sin * top], normal, style);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const a = first + segment * 2;
    builder.addTriangle(a, a + 1, a + 2);
    builder.addTriangle(a + 1, a + 3, a + 2);
  }
};

/** Closed cone (conifer layers, simple caps) with a flat underside. */
export const addCone = (
  builder: MeshBuilder,
  base: Vec3,
  height: number,
  radius: number,
  segments: number,
  style: VertexStyle
) => {
  addFrustum(builder, base, height, [radius, 0.0001], segments, style);
  const centre = builder.addVertex(base, [0, -1, 0], style);
  const first = builder.vertexCount;
  for (let segment = 0; segment <= segments; segment += 1) {
    const angle = (segment / segments) * Math.PI * 2;
    builder.addVertex(
      [base[0] + Math.cos(angle) * radius, base[1], base[2] + Math.sin(angle) * radius],
      [0, -1, 0],
      style
    );
  }
  for (let segment = 0; segment < segments; segment += 1) {
    builder.addTriangle(centre, first + segment + 1, first + segment);
  }
};

const ICOSAHEDRON_VERTICES: Vec3[] = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1]
  ];
  return raw.map(normalize);
})();

const ICOSAHEDRON_FACES = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1]
] as const;

interface Icosphere {
  /** Listed clockwise seen from outside: add them as (a, c, b) for outward facing triangles. */
  faces: [number, number, number][];
  vertices: Vec3[];
}

/** Splits every face in four, new vertices pushed onto the unit sphere. */
const subdivide = (sphere: Icosphere): Icosphere => {
  const vertices = [...sphere.vertices];
  const cache = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const va = vertices[a]!;
    const vb = vertices[b]!;
    vertices.push(normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
    cache.set(key, vertices.length - 1);
    return vertices.length - 1;
  };
  const faces: [number, number, number][] = [];
  for (const [a, b, c] of sphere.faces) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { faces, vertices };
};

/** Unit icosphere: 20 faces, then x4 per subdivision (1: 80 faces, 2: 320 faces). */
const createIcosphere = (subdivisions: number): Icosphere => {
  let sphere: Icosphere = {
    faces: ICOSAHEDRON_FACES.map(([a, b, c]) => [a, b, c]),
    vertices: [...ICOSAHEDRON_VERTICES]
  };
  for (let level = 0; level < subdivisions; level += 1) sphere = subdivide(sphere);
  return sphere;
};

/** One subdivision (80 faces): smooth enough for blobs, cheap enough for many. */
const SPHERE = createIcosphere(1);

/**
 * Lumpy ellipsoid: random radial displacement per vertex gives organic crowns and rocks.
 * `smooth` keeps the sphere normal (soft foliage); false uses face normals (faceted rock).
 */
export const addBlob = (
  builder: MeshBuilder,
  centre: Vec3,
  radii: Vec3,
  lumpiness: number,
  random: Random,
  style: VertexStyle,
  smooth = true
) => {
  const displaced = SPHERE.vertices.map((vertex) => {
    const scale = 1 + (random() - 0.5) * 2 * lumpiness;
    return [
      centre[0] + vertex[0] * radii[0] * scale,
      centre[1] + vertex[1] * radii[1] * scale,
      centre[2] + vertex[2] * radii[2] * scale
    ] as Vec3;
  });
  if (smooth) {
    const first = builder.vertexCount;
    SPHERE.vertices.forEach((vertex, index) => {
      const normal = normalize([vertex[0] / radii[0], vertex[1] / radii[1], vertex[2] / radii[2]]);
      builder.addVertex(displaced[index]!, normal, style);
    });
    for (const [a, b, c] of SPHERE.faces) builder.addTriangle(first + a, first + c, first + b);
    return;
  }
  for (const [a, b, c] of SPHERE.faces) {
    const pa = displaced[a]!;
    const pb = displaced[b]!;
    const pc = displaced[c]!;
    const u: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v: Vec3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cross = normalize([
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ]);
    const outward =
      (pa[0] - centre[0]) * cross[0] +
      (pa[1] - centre[1]) * cross[1] +
      (pa[2] - centre[2]) * cross[2];
    const normal: Vec3 = outward >= 0 ? cross : [-cross[0], -cross[1], -cross[2]];
    const ia = builder.addVertex(pa, normal, style);
    const ib = builder.addVertex(pb, normal, style);
    const ic = builder.addVertex(pc, normal, style);
    builder.addTriangle(ia, ib, ic);
  }
};

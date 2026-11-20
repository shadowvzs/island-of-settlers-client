import type { Object3D, SkinnedMesh } from "three";
import { Vector3 } from "three";

export interface SectionGeometry { label: string; vertices: Float64Array; indices: number[] }
export interface PlaneSection { minX: number; maxX: number; minZ: number; maxZ: number; intersections: number }

/** CPU skinning of precisely the visible native meshes, including rigid joint attachments. */
export const snapshotHatchGeometry = (root: Object3D): SectionGeometry[] => {
  root.updateMatrixWorld(true);
  const result: SectionGeometry[] = [], point = new Vector3();
  root.traverseVisible(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry, position = geometry.getAttribute("position");
    if (!position) return;
    const vertices = new Float64Array(position.count * 3);
    for (let vertex = 0; vertex < position.count; vertex++) {
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(vertex, point);
      else point.fromBufferAttribute(position, vertex);
      point.applyMatrix4(mesh.matrixWorld).toArray(vertices, vertex * 3);
    }
    result.push({ label: mesh.name || mesh.parent?.name || "unnamed",
      vertices, indices: geometry.index ? Array.from(geometry.index.array) : Array.from({ length: position.count }, (_, index) => index) });
  });
  return result;
};

/** Exact triangle/plane intersections; surfaces wholly above/below the deck contribute nothing. */
export const hatchPlaneSection = (geometry: SectionGeometry, height: number): PlaneSection | undefined => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, intersections = 0;
  const add = (x: number, z: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); intersections++;
  };
  const { indices, vertices } = geometry;
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle]! * 3, b = indices[triangle + 1]! * 3, c = indices[triangle + 2]! * 3;
    const ya = vertices[a + 1]!, yb = vertices[b + 1]!, yc = vertices[c + 1]!;
    if (Math.min(ya, yb, yc) > height || Math.max(ya, yb, yc) < height) continue;
    for (const [first, second] of [[a, b], [b, c], [c, a]]) {
      const y0 = vertices[first! + 1]!, y1 = vertices[second! + 1]!;
      if (Math.abs(y0 - height) < 1e-10) add(vertices[first!]!, vertices[first! + 2]!);
      if ((y0 < height && y1 > height) || (y0 > height && y1 < height)) {
        const t = (height - y0) / (y1 - y0);
        add(vertices[first!]! + (vertices[second!]! - vertices[first!]!) * t,
          vertices[first! + 2]! + (vertices[second! + 2]! - vertices[first! + 2]!) * t);
      }
    }
  }
  return intersections ? { minX, maxX, minZ, maxZ, intersections } : undefined;
};

/** Every extremum along a translating fixed pose occurs at a vertex-plane event. */
export const exactSweptHatchLimit = (geometry: SectionGeometry, top: number) => {
  let radius = 0, witness: [number, number, number] | undefined;
  for (const vertex of new Set(geometry.indices)) {
    const offset = vertex * 3, y = geometry.vertices[offset + 1]!;
    if (y < 0 || y > top) continue;
    const x = geometry.vertices[offset]!, z = geometry.vertices[offset + 2]!, size = Math.max(Math.abs(x), Math.abs(z));
    if (size > radius) { radius = size; witness = [x, y, z]; }
  }
  return { radius, witness };
};

type Point = [number, number];
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Convex support of the full vertical sweep, retaining original section witnesses separately. */
export const hatchSweepHull = (parts: SectionGeometry[]): Point[] => {
  const points = parts.flatMap(part => [...new Set(part.indices)].flatMap(vertex => {
    const at = vertex * 3, y = part.vertices[at + 1]!;
    return y >= 0 && y <= 2 ? [[part.vertices[at]!, part.vertices[at + 2]!] as Point] : [];
  })).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Point[] = [], upper: Point[] = [];
  for (const point of points) {
    while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  for (const point of points.toReversed()) {
    while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};

export const fitHatchSweep = (hull: Point[], deltaYaw: number) => {
  const sine = Math.sin(deltaYaw), cosine = Math.cos(deltaYaw);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of hull) {
    const px = x * cosine + z * sine, pz = z * cosine - x * sine;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
  }
  return { deltaYaw, width: maxX - minX, depth: maxZ - minZ, side: Math.max(maxX - minX, maxZ - minZ),
    offsetX: -(minX + maxX) / 2, offsetZ: -(minZ + maxZ) / 2 };
};

export const optimizeHatchSweep = (hull: Point[]) => {
  const candidates = Array.from({ length: 1801 }, (_, step) => fitHatchSweep(hull, step * Math.PI / 1800));
  return candidates.reduce((best, candidate) => candidate.side < best.side ? candidate : best);
};

export const measureHatchPose = (geometry: SectionGeometry[], half: number) => {
  const limits = geometry.map(part => ({ label: part.label, ...exactSweptHatchLimit(part, 2) }));
  const worst = limits.reduce((a, b) => a.radius > b.radius ? a : b);
  const worstPart = geometry.find(part => part.label === worst.label)!;
  const sections = Array.from({ length: 41 }, (_, index) => {
    const height = index * .03;
    const parts = geometry.flatMap(part => {
      const section = hatchPlaneSection(part, height);
      return section ? [{ label: part.label, ...section, clearance: half - Math.max(Math.abs(section.minX), Math.abs(section.maxX),
        Math.abs(section.minZ), Math.abs(section.maxZ)) }] : [];
    });
    return { height, parts };
  });
  return { worst, witnessSection: worst.witness ? hatchPlaneSection(worstPart, worst.witness[1]) : undefined,
    clearance: half - worst.radius, limits, sections, hull: hatchSweepHull(geometry) };
};

export const emptyHatchBands = (step = .01) => Array.from({ length: Math.ceil(1.6 / step) }, (_, index) => ({
  low: index * step, high: (index + 1) * step, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity
}));
export type HatchBands = ReturnType<typeof emptyHatchBands>;
export const mergeHatchBands = (target: HatchBands, source: HatchBands) => source.forEach((band, index) => {
  const into = target[index]!;
  into.minX = Math.min(into.minX, band.minX); into.maxX = Math.max(into.maxX, band.maxX);
  into.minZ = Math.min(into.minZ, band.minZ); into.maxZ = Math.max(into.maxZ, band.maxZ);
});

/** Conservative exact triangle clipping to 10 mm height bands: every intervening plane is bounded. */
export const hatchBandEnvelope = (geometry: SectionGeometry[], yaw: number, step = .01): HatchBands => {
  const bands = emptyHatchBands(step), sine = Math.sin(yaw), cosine = Math.cos(yaw);
  const add = (index: number, x: number, z: number) => {
    const band = bands[index]; if (!band) return;
    const px = x * cosine + z * sine, pz = z * cosine - x * sine;
    band.minX = Math.min(band.minX, px); band.maxX = Math.max(band.maxX, px);
    band.minZ = Math.min(band.minZ, pz); band.maxZ = Math.max(band.maxZ, pz);
  };
  for (const { indices, vertices } of geometry) {
    for (const vertex of new Set(indices)) {
      const at = vertex * 3;
      add(Math.floor(vertices[at + 1]! / step), vertices[at]!, vertices[at + 2]!);
    }
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const ids = indices.slice(triangle, triangle + 3).map(vertex => vertex * 3);
      for (let edge = 0; edge < 3; edge++) {
        const first = ids[edge]!, second = ids[(edge + 1) % 3]!, y0 = vertices[first + 1]!, y1 = vertices[second + 1]!;
        const low = Math.max(0, Math.ceil(Math.min(y0, y1) / step));
        const high = Math.min(bands.length, Math.floor(Math.max(y0, y1) / step));
        if (Math.abs(y1 - y0) < 1e-10) continue;
        for (let boundary = low; boundary <= high; boundary++) {
          const t = (boundary * step - y0) / (y1 - y0);
          const x = vertices[first]! + (vertices[second]! - vertices[first]!) * t;
          const z = vertices[first + 2]! + (vertices[second + 2]! - vertices[first + 2]!) * t;
          add(boundary - 1, x, z); add(boundary, x, z);
        }
      }
    }
  }
  return bands;
};

export const describeHatchBands = (bands: HatchBands) => bands.filter(band => Number.isFinite(band.minX)).map(band => ({
  ...band, width: band.maxX - band.minX, depth: band.maxZ - band.minZ,
  side: Math.max(band.maxX - band.minX, band.maxZ - band.minZ),
  offsetX: -(band.minX + band.maxX) / 2, offsetZ: -(band.minZ + band.maxZ) / 2
}));

export const hatchHeadCenterWeight = (height: number) => {
  const t = Math.max(0, Math.min(1, (height - .72) / .23));
  return t * t * (3 - 2 * t);
};
/** Shared maneuver follows the actual rig's head projection while it crosses the opening. */
export const headCenteredHatchBands = (bands: HatchBands, headX: number, headZ: number): HatchBands => bands.map(band => {
  const first = hatchHeadCenterWeight(band.low), last = hatchHeadCenterWeight(band.high);
  return { ...band, minX: band.minX + Math.min(-headX * first, -headX * last),
    maxX: band.maxX + Math.max(-headX * first, -headX * last),
    minZ: band.minZ + Math.min(-headZ * first, -headZ * last),
    maxZ: band.maxZ + Math.max(-headZ * first, -headZ * last) };
});

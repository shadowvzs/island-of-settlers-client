import { BufferGeometry, Float32BufferAttribute, LatheGeometry, Vector2 } from "three";

/**
 * Low-level forms of the issued equipment: lofted blades, lathed grips and shield plates. All
 * return plain geometries (no materials) for military-equipment-mesh.ts to bake; they run
 * without a DOM so budgets are unit tested.
 */
type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];

const triangles = (vertices: number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
};

const pushQuad = (target: number[], a: Point3, b: Point3, c: Point3, d: Point3) =>
  target.push(...a, ...b, ...c, ...a, ...c, ...d);

/** One blade station: height, centre-line offset (curve, `z` through) and half sizes. */
export interface BladeStation { halfThickness: number; halfWidth: number; x: number; y: number; z?: number }

/** Cross-sections, as unit [across, through] loops. +x is the cutting edge. */
export const BLADE_SECTIONS = {
  /** Double-edged lenticular blade (gladius, spatha). */
  diamond: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  /** Double edge with a central fuller groove (Viking sword). */
  fullered: [[1, 0], [.55, .75], [.22, .35], [-.22, .35], [-.55, .75], [-1, 0], [-.55, -.75],
    [-.22, -.35], [.22, -.35], [.55, -.75]],
  /** Single edge with a ridge line and a flat back (katana, seax). */
  singleEdge: [[1, 0], [.15, .85], [-1, .55], [-1, -.55], [.15, -.85]],
  /** Rectangular bar (shield spine, haft lashings). */
  rectangle: [[1, -1], [1, 1], [-1, 1], [-1, -1]],
  /** Single edge, cheapest: edge and a flat back. */
  wedge: [[1, 0], [-1, .7], [-1, -.7]]
} as const satisfies Record<string, readonly Point2[]>;

/** Faceted (flat-shaded) loft of a cross-section through the stations; zero width closes a tip. */
export const loftBlade = (stations: readonly BladeStation[], section: readonly Point2[]) => {
  const vertices: number[] = [];
  const ring = (station: BladeStation) => section.map(([across, through]) =>
    [station.x + across * station.halfWidth, station.y, (station.z ?? 0) + through * station.halfThickness] as const);
  for (let index = 1; index < stations.length; index++) {
    const lower = ring(stations[index - 1]!), upper = ring(stations[index]!);
    for (let corner = 0; corner < section.length; corner++) {
      const next = (corner + 1) % section.length;
      pushQuad(vertices, lower[next]!, lower[corner]!, upper[corner]!, upper[next]!);
    }
  }
  return triangles(vertices);
};

/** Turned part (grip, pommel, boss) from [radius, height] points, axis +Y. */
export const lathe = (profile: readonly Point2[], segments: number) =>
  new LatheGeometry(profile.map(([radius, y]) => new Vector2(radius, y)), segments);

/** A shield board: front, back and rim band, so each can take its own finish. */
export interface ShieldPlate { back: BufferGeometry; front: BufferGeometry; rim: BufferGeometry }

/**
 * Oval or round plate facing +Z. `bulge(r)` lifts the front at relative radius r (0 centre,
 * 1 rim) for a domed board; the back is flat at `back`, the rim joins both edges.
 */
export const ovalPlate = (options: {
  back: number; bulge: (radius: number) => number; radiusX: number; radiusY: number;
  rings: number; segments: number; thickness: number;
}) => {
  const { back, bulge, radiusX, radiusY, rings, segments, thickness } = options;
  const point = (ring: number, segment: number): Point3 => {
    const radius = ring / rings, angle = segment / segments * Math.PI * 2;
    return [Math.cos(angle) * radiusX * radius, Math.sin(angle) * radiusY * radius,
      back + thickness + bulge(radius)];
  };
  const front: number[] = [], rear: number[] = [], rim: number[] = [];
  for (let segment = 0; segment < segments; segment++) {
    const next = segment + 1;
    front.push(...point(0, 0), ...point(1, segment), ...point(1, next));
    for (let ring = 1; ring < rings; ring++)
      pushQuad(front, point(ring, segment), point(ring + 1, segment), point(ring + 1, next), point(ring, next));
    const edge = point(rings, segment), edgeNext = point(rings, next);
    rear.push(0, 0, back, edgeNext[0], edgeNext[1], back, edge[0], edge[1], back);
    pushQuad(rim, [edge[0], edge[1], back], [edgeNext[0], edgeNext[1], back], edgeNext, edge);
  }
  return { back: triangles(rear), front: triangles(front), rim: triangles(rim) };
};

/**
 * Rectangular board bent round the vertical axis (scutum, tate): `curve` is how far the centre
 * stands proud of the side edges. Columns subdivide the bend.
 */
export const curvedPlate = (options: {
  back: number; columns: number; curve: number; height: number; thickness: number; width: number;
}) => {
  const { back, columns, curve, height, thickness, width } = options;
  const at = (column: number, y: number, depth: number): Point3 => {
    const x = (column / columns - .5) * width;
    return [x, y, back + depth + curve * (1 - (2 * x / width) ** 2)];
  };
  const front: number[] = [], rear: number[] = [], rim: number[] = [];
  const top = height / 2, bottom = -height / 2;
  for (let column = 0; column < columns; column++) {
    const next = column + 1;
    pushQuad(front, at(column, bottom, thickness), at(next, bottom, thickness), at(next, top, thickness),
      at(column, top, thickness));
    pushQuad(rear, at(next, bottom, 0), at(column, bottom, 0), at(column, top, 0), at(next, top, 0));
    pushQuad(rim, at(column, top, thickness), at(next, top, thickness), at(next, top, 0), at(column, top, 0));
    pushQuad(rim, at(next, bottom, thickness), at(column, bottom, thickness), at(column, bottom, 0),
      at(next, bottom, 0));
  }
  for (const column of [0, columns]) {
    const side = column === 0 ? -1 : 1;
    const corners = [at(column, bottom, 0), at(column, bottom, thickness), at(column, top, thickness),
      at(column, top, 0)] as const;
    if (side > 0) pushQuad(rim, corners[0], corners[3], corners[2], corners[1]);
    else pushQuad(rim, ...corners);
  }
  return { back: triangles(rear), front: triangles(front), rim: triangles(rim) };
};

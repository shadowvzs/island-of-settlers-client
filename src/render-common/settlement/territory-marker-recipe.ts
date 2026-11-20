import { MeshBuilder, normalize, type Vec3, type VertexStyle } from "../props/mesh-builder";

/** Original Roman boundary stone, in tile units. Buried toe avoids floating on its sampled ground. */
export const TERRITORY_MARKER_HEIGHT = 0.44;
export const TERRITORY_MARKER_LOD_ZOOM = 0.65;

const OUTLINE = [
  [-0.105, -0.083],
  [-0.083, -0.105],
  [0.083, -0.105],
  [0.105, -0.083],
  [0.105, 0.083],
  [0.083, 0.105],
  [-0.083, 0.105],
  [-0.105, 0.083]
] as const;
const GRANITE: Vec3 = [0.72, 0.69, 0.60];
export const TERRITORY_MARKER_PAINT: Vec3 = [0.8, 0.09, 0.045];
const EMBLEM: Vec3 = [0.89, 0.73, 0.39];

const style = (color: Vec3): VertexStyle => ({ color: () => color, flutter: 0 });

const stoneStyle: VertexStyle = {
  color: (position) => {
    const fleck = Math.sin(position[0] * 71 + position[1] * 37 + position[2] * 93) * 0.055;
    const damp = position[1] < 0.045 ? 0.8 : 1;
    return [(GRANITE[0] + fleck) * damp, (GRANITE[1] + fleck) * damp, (GRANITE[2] + fleck) * damp];
  },
  flutter: 0
};

const addRingSection = (
  builder: MeshBuilder,
  lower: number,
  upper: number,
  lowerScale: number,
  upperScale: number,
  surface: VertexStyle
) => {
  OUTLINE.forEach(([x, z], index) => {
    const [nextX, nextZ] = OUTLINE[(index + 1) % OUTLINE.length]!;
    const horizontal = normalize([nextZ - z, 0, x - nextX]);
    const normal = normalize([
      horizontal[0],
      (0.105 * (lowerScale - upperScale)) / (upper - lower),
      horizontal[2]
    ]);
    const first = builder.vertexCount;
    builder.addVertex([x * lowerScale, lower, z * lowerScale], normal, surface);
    builder.addVertex([x * upperScale, upper, z * upperScale], normal, surface);
    builder.addVertex([nextX * lowerScale, lower, nextZ * lowerScale], normal, surface);
    builder.addVertex([nextX * upperScale, upper, nextZ * upperScale], normal, surface);
    builder.addTriangle(first, first + 1, first + 2);
    builder.addTriangle(first + 1, first + 3, first + 2);
  });
};

const addCap = (builder: MeshBuilder, y: number, scale: number, up: boolean) => {
  const normal: Vec3 = [0, up ? 1 : -1, 0];
  const centre = builder.addVertex([0, y, 0], normal, stoneStyle);
  const first = builder.vertexCount;
  for (const [x, z] of OUTLINE) builder.addVertex([x * scale, y, z * scale], normal, stoneStyle);
  OUTLINE.forEach((_point, index) => {
    const next = first + ((index + 1) % OUTLINE.length);
    if (up) builder.addTriangle(centre, next, first + index);
    else builder.addTriangle(centre, first + index, next);
  });
};

const addFace = (builder: MeshBuilder, points: readonly Vec3[], color: Vec3, side: number) => {
  const first = builder.vertexCount;
  for (const point of points) builder.addVertex(point, [0, 0, side], style(color));
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  for (let index = 1; index < points.length - 1; index++) {
    if (signedArea * side > 0) builder.addTriangle(first, first + index, first + index + 1);
    else builder.addTriangle(first, first + index + 1, first + index);
  }
};

/** A small original branching waymark; geometry remains clear without a sprite or copied emblem. */
const addEmblem = (builder: MeshBuilder, side: number) => {
  const z = side * 0.1055;
  addFace(
    builder,
    [
      [-0.009, 0.278, z],
      [0.009, 0.278, z],
      [0.009, 0.331, z],
      [-0.009, 0.331, z]
    ],
    EMBLEM,
    side
  );
  addFace(
    builder,
    [
      [-0.007, 0.298, z],
      [-0.052, 0.322, z],
      [-0.035, 0.33, z],
      [0.007, 0.309, z]
    ],
    EMBLEM,
    side
  );
  addFace(
    builder,
    [
      [-0.007, 0.309, z],
      [0.035, 0.33, z],
      [0.052, 0.322, z],
      [0.007, 0.298, z]
    ],
    EMBLEM,
    side
  );
};

const addWeathering = (builder: MeshBuilder) => {
  builder.detail = true;
  for (const side of [-1, 1]) {
    const z = side * 0.108;
    addFace(
      builder,
      [
        [-0.087, 0.006, z],
        [-0.012, 0.006, z],
        [-0.02, 0.054, z],
        [-0.055, 0.036, z]
      ],
      [0.24, 0.3, 0.13],
      side
    );
    addFace(
      builder,
      [
        [0.06, 0.004, z],
        [0.084, 0.007, z],
        [0.072, 0.029, z]
      ],
      [0.28, 0.33, 0.17],
      side
    );
    addFace(
      builder,
      [
        [-0.025, 0.365, z * 0.95],
        [-0.018, 0.381, z * 0.95],
        [-0.001, 0.357, z * 0.95]
      ],
      [0.35, 0.33, 0.29],
      side
    );
  }
};

export const createTerritoryMarkerRecipe = (detailed: boolean) => {
  const builder = new MeshBuilder();
  addRingSection(builder, -0.035, 0.025, 1.04, 1.02, stoneStyle);
  addRingSection(builder, 0.025, 0.265, 1.02, 0.985, stoneStyle);
  addRingSection(builder, 0.265, 0.343, 0.99, 0.98, style(TERRITORY_MARKER_PAINT));
  addRingSection(builder, 0.343, 0.413, 0.98, 0.96, stoneStyle);
  addRingSection(builder, 0.413, TERRITORY_MARKER_HEIGHT, 0.96, 0.72, stoneStyle);
  addCap(builder, -0.035, 1.04, false);
  addCap(builder, TERRITORY_MARKER_HEIGHT, 0.72, true);
  addEmblem(builder, 1);
  addEmblem(builder, -1);
  if (detailed) addWeathering(builder);
  return builder.finish({ flex: 0 });
};

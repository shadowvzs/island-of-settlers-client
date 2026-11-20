import { createRandom } from "../../shared/world/rng";
import {
  addBlob,
  addFrustum,
  MeshBuilder,
  type PropMesh,
  type Vec3,
  type VertexStyle
} from "../props/mesh-builder";

/** Height of the windmill hub; the blades rotate around the x axis through it. */
export const WINDMILL_HUB: Vec3 = [0.55, 1.95, 0];

const solid = (color: Vec3): VertexStyle => ({ color: () => color, flutter: 0 });

const BOX_FACES: [Vec3, Vec3, Vec3][] = [
  [
    [1, 0, 0],
    [0, 0, 1],
    [0, 1, 0]
  ],
  [
    [-1, 0, 0],
    [0, 0, -1],
    [0, 1, 0]
  ],
  [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1]
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, -1]
  ],
  [
    [0, 0, 1],
    [-1, 0, 0],
    [0, 1, 0]
  ],
  [
    [0, 0, -1],
    [1, 0, 0],
    [0, 1, 0]
  ]
];

/** Axis aligned box with flat shaded faces. */
const addBox = (builder: MeshBuilder, centre: Vec3, size: Vec3, style: VertexStyle) => {
  for (const [normal, u, v] of BOX_FACES) {
    const first = builder.vertexCount;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ] as const) {
      const position: Vec3 = [0, 1, 2].map(
        (axis) =>
          centre[axis]! +
          (normal[axis]! * size[axis]!) / 2 +
          (u[axis]! * su * size[axis]!) / 2 +
          (v[axis]! * sv * size[axis]!) / 2
      ) as unknown as Vec3;
      builder.addVertex(position, normal, style);
    }
    builder.addTriangle(first, first + 1, first + 2);
    builder.addTriangle(first, first + 2, first + 3);
  }
};

/** Gable roof as a prism along z. */
const addRoof = (builder: MeshBuilder, base: number, size: Vec3, style: VertexStyle) => {
  const [halfX, height, halfZ] = [size[0] / 2, size[1], size[2] / 2];
  const slopes: [Vec3, Vec3[]][] = [
    [
      [-0.7, 0.7, 0],
      [
        [-halfX, base, -halfZ],
        [-halfX, base, halfZ],
        [0, base + height, halfZ],
        [0, base + height, -halfZ]
      ]
    ],
    [
      [0.7, 0.7, 0],
      [
        [halfX, base, halfZ],
        [halfX, base, -halfZ],
        [0, base + height, -halfZ],
        [0, base + height, halfZ]
      ]
    ]
  ];
  for (const [normal, corners] of slopes) {
    const first = builder.vertexCount;
    for (const corner of corners) builder.addVertex(corner, normal, style);
    builder.addTriangle(first, first + 1, first + 2);
    builder.addTriangle(first, first + 2, first + 3);
  }
  for (const side of [-1, 1]) {
    const first = builder.vertexCount;
    builder.addVertex([-halfX, base, side * halfZ], [0, 0, side], style);
    builder.addVertex([halfX, base, side * halfZ], [0, 0, side], style);
    builder.addVertex([0, base + height, side * halfZ], [0, 0, side], style);
    builder.addTriangle(first, first + 1, first + 2);
  }
};

/** Timber framed house (walls, beams, windows, door, roof, chimney): about 300 triangles. */
export const createHouseMesh = () => {
  const builder = new MeshBuilder();
  addBox(builder, [0, 0.4, 0], [1.3, 0.8, 1.1], solid([0.86, 0.8, 0.68]));
  for (const x of [-0.64, 0.64]) {
    for (const z of [-0.54, 0.54])
      addBox(builder, [x, 0.4, z], [0.08, 0.82, 0.08], solid([0.36, 0.25, 0.16]));
  }
  addBox(builder, [0.655, 0.25, 0.1], [0.04, 0.45, 0.3], solid([0.3, 0.2, 0.12]));
  for (const z of [-0.3, 0.35])
    addBox(builder, [0.655, 0.55, z], [0.03, 0.18, 0.18], solid([0.25, 0.35, 0.45]));
  addRoof(builder, 0.8, [1.5, 0.55, 1.3], solid([0.62, 0.28, 0.2]));
  addBox(builder, [-0.3, 1.2, 0.3], [0.16, 0.45, 0.16], solid([0.5, 0.48, 0.45]));
  return builder.finish();
};

/** Windmill tower and cap; the blades are a separate mesh rotating around WINDMILL_HUB. */
export const createWindmillMesh = () => {
  const builder = new MeshBuilder();
  addFrustum(builder, [0, 0, 0], 1.8, [0.55, 0.38], 12, solid([0.88, 0.85, 0.78]));
  addBlob(builder, [0, 1.85, 0], [0.45, 0.28, 0.45], 0, createRandom(3), solid([0.45, 0.3, 0.2]));
  addBox(builder, [0.56, 0.3, 0], [0.04, 0.5, 0.3], solid([0.3, 0.2, 0.12]));
  return builder.finish();
};

/** Four sail blades in the y/z plane around the origin (placed at the hub by the renderer). */
export const createWindmillBladesMesh = () => {
  const builder = new MeshBuilder();
  const sail = solid([0.9, 0.88, 0.82]);
  for (let blade = 0; blade < 4; blade += 1) {
    const angle = (blade / 4) * Math.PI * 2;
    const direction: Vec3 = [0, Math.cos(angle), Math.sin(angle)];
    addBox(
      builder,
      [0, direction[1] * 0.55, direction[2] * 0.55],
      [0.03, Math.abs(direction[1]) * 1 + 0.12, Math.abs(direction[2]) * 1 + 0.12],
      sail
    );
  }
  addBox(builder, [0, 0, 0], [0.12, 0.12, 0.12], solid([0.3, 0.22, 0.15]));
  return builder.finish();
};

/** Small fish facing +x; the tail (negative x) swings in the vertex shader. */
export const createFishMesh = () => {
  const builder = new MeshBuilder();
  addBlob(
    builder,
    [0, 0, 0],
    [0.16, 0.05, 0.045],
    0.05,
    createRandom(9),
    solid([0.45, 0.52, 0.55])
  );
  const tail = builder.vertexCount;
  const fin: VertexStyle = { color: () => [0.4, 0.46, 0.5], flutter: 1 };
  builder.addVertex([-0.14, 0, 0], [0, 0, 1], fin);
  builder.addVertex([-0.26, 0.06, 0], [0, 0, 1], fin);
  builder.addVertex([-0.26, -0.06, 0], [0, 0, 1], fin);
  builder.addTriangle(tail, tail + 1, tail + 2);
  return builder.finish();
};

/** Buildings, blades and fish do not bend in the wind: bend weights off, flutter kept. */
export const withoutWindBend = (mesh: PropMesh): PropMesh => ({
  ...mesh,
  wind: mesh.wind.map((value, index) => (index % 2 === 0 ? 0 : value))
});

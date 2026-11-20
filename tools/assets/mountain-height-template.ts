import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";

/** Offline only: project the attributed source's top surface into editable terrain samples. */
const source = resolve("../resources/models/rocks/mountains/great_mountain.glb");
const bytes = readFileSync(source);
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
const binaryOffset = 28 + jsonLength;
const SIZE = 33;
type Point = [number, number, number];
const vertices: Point[] = [];
const triangles: number[] = [];

const readAccessor = (index: number, components: number) => {
  const accessor = gltf.accessors[index];
  if (accessor.sparse || accessor.normalized) throw new Error("Unsupported source accessor");
  const view = gltf.bufferViews[accessor.bufferView];
  const type = accessor.componentType;
  const width = type === 5123 ? 2 : 4;
  const stride = view.byteStride ?? width * components;
  const start = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({ length: accessor.count * components }, (_, index) => {
    const offset = start + Math.floor(index / components) * stride + (index % components) * width;
    if (type === 5126) return bytes.readFloatLE(offset);
    if (type === 5125) return bytes.readUInt32LE(offset);
    if (type === 5123) return bytes.readUInt16LE(offset);
    throw new Error(`Unsupported source component type ${type}`);
  });
};

const visit = (index: number, parent: Matrix4) => {
  const node = gltf.nodes[index];
  const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
    new Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new Vector3().fromArray(node.scale ?? [1, 1, 1])
  );
  const matrix = parent.clone().multiply(local);
  if (node.mesh !== undefined) {
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      if ((primitive.mode ?? 4) !== 4) throw new Error("Source must use triangles");
      const positions = readAccessor(primitive.attributes.POSITION, 3);
      const first = vertices.length;
      for (let offset = 0; offset < positions.length; offset += 3) {
        vertices.push(new Vector3().fromArray(positions, offset).applyMatrix4(matrix).toArray());
      }
      const indices = primitive.indices === undefined
        ? Array.from({ length: positions.length / 3 }, (_, index) => index)
        : readAccessor(primitive.indices, 1);
      for (const index of indices) triangles.push(first + index);
    }
  }
  for (const child of node.children ?? []) visit(child, matrix);
};
for (const node of gltf.scenes[gltf.scene ?? 0].nodes) visit(node, new Matrix4());

const minimum = [Infinity, Infinity, Infinity];
const maximum = [-Infinity, -Infinity, -Infinity];
for (const point of vertices) for (let axis = 0; axis < 3; axis += 1) {
  minimum[axis] = Math.min(minimum[axis]!, point[axis]!);
  maximum[axis] = Math.max(maximum[axis]!, point[axis]!);
}
const heights = new Float64Array(SIZE * SIZE).fill(-Infinity);
const extent = maximum.map((value, axis) => value - minimum[axis]!);
const normalized = vertices.map(([x, y, z]): Point => [
  (x - minimum[0]!) / extent[0]! * (SIZE - 1),
  (y - minimum[1]!) / extent[1]!,
  (z - minimum[2]!) / extent[2]! * (SIZE - 1)
]);

const rasterize = (a: Point, b: Point, c: Point) => {
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(denominator) < 1e-12) return;
  const lowX = Math.max(0, Math.ceil(Math.min(a[0], b[0], c[0])));
  const highX = Math.min(SIZE - 1, Math.floor(Math.max(a[0], b[0], c[0])));
  const lowZ = Math.max(0, Math.ceil(Math.min(a[2], b[2], c[2])));
  const highZ = Math.min(SIZE - 1, Math.floor(Math.max(a[2], b[2], c[2])));
  for (let z = lowZ; z <= highZ; z += 1) for (let x = lowX; x <= highX; x += 1) {
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-7) continue;
    const index = z * SIZE + x;
    heights[index] = Math.max(heights[index]!, u * a[1] + v * b[1] + w * c[1]);
  }
};
for (let offset = 0; offset < triangles.length; offset += 3) {
  rasterize(normalized[triangles[offset]!]!, normalized[triangles[offset + 1]!]!,
    normalized[triangles[offset + 2]!]!);
}
const covered = Array.from(heights).filter(Number.isFinite).length;
// Remove the rectangular source edge. The outer annulus meets original terrain at zero rise
// and zero derivative; missing projection samples never create holes or below-ground cuts.
for (let z = 0; z < SIZE; z += 1) for (let x = 0; x < SIZE; x += 1) {
  const radius = Math.hypot(x / (SIZE - 1) * 2 - 1, z / (SIZE - 1) * 2 - 1);
  const t = Math.min(1, Math.max(0, (1 - radius) / 0.32));
  const index = z * SIZE + x;
  heights[index] = Number.isFinite(heights[index]) ? heights[index]! * t * t * (3 - 2 * t) : 0;
}
const peak = Math.max(...heights);
if (!(peak > 0.1) || covered < SIZE * SIZE * 0.9) throw new Error("Incomplete source projection");
const samples = Array.from(heights, value => Math.round(value / peak * 65535));
const rows = Array.from({ length: SIZE }, (_, row) =>
  `  ${samples.slice(row * SIZE, (row + 1) * SIZE).join(", ")},`);
writeFileSync("src/shared/world/editing/terrain/alpine-height-data.ts",
  "/** Generated by tools/assets/mountain-height-template.ts; see docs/reference/asset-credits.md. */\n" +
  `export const ALPINE_HEIGHT_SIZE = ${SIZE};\nexport const ALPINE_HEIGHT_SAMPLES = new Uint16Array([\n` +
  rows.join("\n") + "\n]);\n");
const output = resolve("../resources/terrain-benchmarks/mountain-template");
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/processing.json`, JSON.stringify({
  source: "rocks/mountains/great_mountain.glb", sourceTriangles: triangles.length / 3,
  sourceSha256: createHash("sha256").update(bytes).digest("hex"), size: SIZE,
  projectedCoverage: covered / (SIZE * SIZE), sourceExtent: extent,
  normalizedPeakBeforeFeather: peak, sampleBytes: samples.length * 2,
  modifications: "Scene transforms baked; top projection; normalized height; circular feather; Uint16 quantization"
}, null, 2));
console.log(`Processed ${triangles.length / 3} source triangles into ${samples.length * 2} height bytes`);

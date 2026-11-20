import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

// Offline dependencies only; never added to the runtime bundle or original source collection.
const toolkit = process.argv[2];
if (!toolkit) throw new Error("Pass a directory containing node_modules/{meshoptimizer,sharp}");
const { MeshoptSimplifier } = await import(pathToFileURL(resolve(toolkit, "node_modules/meshoptimizer/index.js")));
const require = createRequire(resolve(toolkit, "package.json"));
const sharp = require("sharp");
await MeshoptSimplifier.ready;
const project = resolve(import.meta.dirname, "../..");
const source = resolve(project, "../resources/hardwood/models");
// Small metadata (static import: crowns, stumps, felling) and the bulky gzip-compressed binary payload
// (fetched on demand by hardwood-mesh-loader.ts).
const metaOutput = resolve(project, "src/render-common/trees/hardwood-mesh-meta.json");
const payloadOutput = resolve(project, "src/render-common/trees/hardwood-mesh-data.gz.bin");
const names = ["01-broad-crown", "02-twin-stem", "03-upright", "04-leaning-crown"];
const LEAF_VERTICES = 51;

const loadGlb = async path => {
  const bytes = await readFile(path);
  const size = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + size).toString());
  const binary = bytes.subarray(28 + size);
  const accessor = id => {
    const value = json.accessors[id], view = json.bufferViews[value.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[value.type];
    const stride = view.byteStride ?? width * 4;
    const offset = (view.byteOffset ?? 0) + (value.byteOffset ?? 0);
    const array = new Float32Array(value.count * width);
    for (let i = 0; i < value.count; i++) for (let c = 0; c < width; c++)
      array[i * width + c] = value.componentType === 5125
        ? binary.readUInt32LE(offset + i * stride + c * 4)
        : binary.readFloatLE(offset + i * stride + c * 4);
    return array;
  };
  const textures = await Promise.all([0, 3].map(async id => {
    const image = json.images[id], view = json.bufferViews[image.bufferView];
    return sharp(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength))
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  }));
  return { json, accessor, textures, sha256: createHash("sha256").update(bytes).digest("hex") };
};

const buildMesh = async name => {
  const glb = await loadGlb(resolve(source, `hardwood-${name}.glb`));
  const vertices = [], core = [], detail = [], minimal = [];
  const addVertex = (position, normal, uv, color, family) => {
    const image = glb.textures[family];
    const x = Math.min(image.info.width - 1, Math.floor((uv[0] % 1 + 1) % 1 * image.info.width));
    const y = Math.min(image.info.height - 1, Math.floor((uv[1] % 1 + 1) % 1 * image.info.height));
    const offset = (y * image.info.width + x) * image.info.channels;
    const painted = [0, 1, 2].map(c => Math.round(Math.min(255, image.data[offset + c] * color[c])));
    vertices.push({ position, normal, uv, color: painted, family });
    return vertices.length - 1;
  };
  const primitive = index => {
    const mesh = glb.json.meshes[index].primitives[0];
    return { p: glb.accessor(mesh.attributes.POSITION), n: glb.accessor(mesh.attributes.NORMAL),
      uv: glb.accessor(mesh.attributes.TEXCOORD_0), color: glb.accessor(mesh.attributes.COLOR_0),
      indices: Uint32Array.from(glb.accessor(mesh.indices)) };
  };
  for (const meshId of [0, 1]) {
    const mesh = primitive(meshId);
    const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.p, 3,
      (meshId === 0 ? 1100 : 350) * 3, .08, ["Permissive", "Prune"]);
    const remap = new Map();
    const vertex = id => {
      if (!remap.has(id)) remap.set(id, addVertex(Array.from(mesh.p.slice(id * 3, id * 3 + 3)),
        Array.from(mesh.n.slice(id * 3, id * 3 + 3)), Array.from(mesh.uv.slice(id * 2, id * 2 + 2)),
        mesh.color.slice(id * 4, id * 4 + 3), 0));
      return remap.get(id);
    };
    for (const id of indices) core.push(vertex(id));
    const [low] = MeshoptSimplifier.simplify(mesh.indices, mesh.p, 3,
      (meshId === 0 ? 120 : 24) * 3, .3, ["Permissive", "Prune"]);
    for (const id of low) minimal.push(vertex(id));
  }
  const leaves = primitive(2), count = leaves.p.length / 3 / LEAF_VERTICES;
  if (!Number.isInteger(count)) throw new Error(`Unexpected source leaf topology: ${name}`);
  // Retain every original leaf at its original size/position. Two small curved-face triangles
  // replace each 64-triangle blade, rather than thinning the canopy and enlarging the survivors.
  for (let leaf = 0; leaf < count; leaf++) {
    const first = vertices.length;
    for (const local of [1, 24, 49, 26]) {
      const id = leaf * LEAF_VERTICES + local;
      const position = Array.from(leaves.p.slice(id * 3, id * 3 + 3));
      addVertex(position, Array.from(leaves.n.slice(id * 3, id * 3 + 3)),
        Array.from(leaves.uv.slice(id * 2, id * 2 + 2)), leaves.color.slice(id * 4, id * 4 + 3), 1);
    }
    const target = leaf % 2 ? detail : core;
    target.push(first, first + 1, first + 2, first, first + 2, first + 3);
    if (leaf % 16 === 0) minimal.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  if (vertices.length > 65535) throw new Error("Prop vertex budget exceeded");
  const height = Math.max(...vertices.map(v => v.position[1]));
  const factor = 3.25 / height;
  const minimum = [0, 1, 2].map(c => Math.min(...vertices.map(v => v.position[c] * factor)));
  const maximum = [0, 1, 2].map(c => Math.max(...vertices.map(v => v.position[c] * factor)));
  const packed = Buffer.alloc(vertices.length * 18);
  let radius = 0;
  vertices.forEach((v, i) => {
    const offset = i * 18;
    for (let c = 0; c < 3; c++) {
      const position = v.position[c] * factor;
      packed.writeUInt16LE(Math.round((position - minimum[c]) / (maximum[c] - minimum[c]) * 65535), offset + c * 2);
      packed.writeInt8(Math.max(-127, Math.min(127, Math.round(v.normal[c] * 127))), offset + 6 + c);
      packed.writeUInt8(v.color[c], offset + 9 + c);
    }
    packed.writeUInt8(v.family, offset + 12);
    packed.writeUInt8(0, offset + 13);
    packed.writeInt16LE(Math.round((v.uv[0] % 1) * 32767), offset + 14);
    packed.writeInt16LE(Math.round(Math.max(-32, Math.min(32, v.uv[1])) * 1000), offset + 16);
    radius = Math.max(radius, Math.hypot(v.position[0], v.position[2]) * factor);
  });
  const indices = Uint16Array.from([...core, ...detail]);
  const crown = vertices.filter(vertex => vertex.family === 1);
  const crownHeight = (Math.min(...crown.map(v => v.position[1])) +
    Math.max(...crown.map(v => v.position[1]))) / 2 * factor;
  return { name, sha256: glb.sha256, min: minimum, max: maximum, radius,
    trunkRadius: name.startsWith("02") ? .13 : .15,
    crownHeight, crownRadius: radius, coreIndexCount: core.length,
    vertices: packed, indices: Buffer.from(indices.buffer),
    minimalIndices: Buffer.from(Uint16Array.from(minimal).buffer),
    statistics: { vertices: vertices.length, fullTriangles: indices.length / 3,
      coreTriangles: core.length / 3, minimalTriangles: minimal.length / 3,
      sourceLeaves: count, retainedLeaves: count, leafScale: 1 } };
};

const PAYLOAD_PARTS = ["vertices", "indices", "minimalIndices"];
const variants = [], parts = [];
let payloadBytes = 0;
for (const name of names) {
  const mesh = await buildMesh(name);
  // Each part becomes an { offset, length } range of the payload file.
  for (const part of PAYLOAD_PARTS) {
    const bytes = mesh[part];
    mesh[part] = { offset: payloadBytes, length: bytes.length };
    parts.push(bytes);
    payloadBytes += bytes.length;
  }
  variants.push(mesh);
  process.stdout.write(`${name}: ${JSON.stringify(mesh.statistics)}\n`);
}
await mkdir(resolve(metaOutput, ".."), { recursive: true });
await writeFile(payloadOutput, gzipSync(Buffer.concat(parts), { level: 9 }));
await writeFile(metaOutput, JSON.stringify({ version: 2, vertexBytes: 18, payloadBytes, variants }));

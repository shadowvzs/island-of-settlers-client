import { readFile } from "node:fs/promises";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Original geometry/skin/animations; omit images only in memory for deterministic CPU checks. */
export const readCpuGltf = async (path: string | URL) => {
  const bytes = await readFile(path), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  json.images = []; json.textures = []; json.materials = [{}];
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) primitive.material = 0;
  json.extensionsRequired = json.extensionsRequired?.filter((name: string) => name !== "KHR_texture_basisu");
  const encoded = Buffer.from(JSON.stringify(json)), padded = Math.ceil(encoded.length / 4) * 4;
  const buffer = Buffer.alloc(20 + padded + bytes.length - 20 - jsonLength, 0x20);
  bytes.copy(buffer, 0, 0, 12); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(padded, 12); buffer.writeUInt32LE(0x4e4f534a, 16); encoded.copy(buffer, 20);
  bytes.copy(buffer, 20 + padded, 20 + jsonLength);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
};

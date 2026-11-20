import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ray, Vector3 } from "three";
import { expect, it } from "vitest";

import { MONUMENT_ASSETS } from "../src/render-common/buildings/monument-definition";

const folder = new URL("../assets/monuments/", import.meta.url);
const receipt = JSON.parse(readFileSync(new URL("japanese-continuity.json", folder), "utf8"));
const read = (name: string) => {
  const bytes = readFileSync(new URL(name, folder)), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binary = bytes.subarray(28 + jsonLength);
  return { binary, bytes, json };
};
type Asset = ReturnType<typeof read>;
const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const values = (asset: Asset, id: number) => {
  const accessor = asset.json.accessors[id], view = asset.json.bufferViews[accessor.bufferView];
  const count = width[accessor.type as keyof typeof width];
  const bytes = accessor.componentType === 5123 ? 2 : 4;
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const step = view.byteStride ?? count * bytes;
  return Array.from({ length: accessor.count }, (_, index) => Array.from({ length: count }, (_, axis) => {
    const at = offset + index * step + axis * bytes;
    if (accessor.componentType === 5126) return asset.binary.readFloatLE(at);
    return bytes === 2 ? asset.binary.readUInt16LE(at) : asset.binary.readUInt32LE(at);
  }));
};

const sourceBands = (asset: Asset) => {
  const triangles: Vector3[][] = [];
  for (const mesh of asset.json.meshes) for (const primitive of mesh.primitives) {
    const positions = values(asset, primitive.attributes.POSITION).map(point => new Vector3(...point));
    const indices = values(asset, primitive.indices).flat();
    for (let index = 0; index < indices.length; index += 3)
      triangles.push(indices.slice(index, index + 3).map(vertex => positions[vertex]!));
  }
  return Array.from({ length: 11 }, (_, level) => {
    const ray = new Ray(new Vector3(0, 1.93 + level * .785 + .67, 6), new Vector3(0, 0, -1));
    return triangles.some(triangle => ray.intersectTriangle(triangle[0]!, triangle[1]!, triangle[2]!, true,
      new Vector3()) !== null);
  });
};

it.each(["high", "minimal"] as const)("repairs Japanese %s storeys while preserving every original part, material and anchor", quality => {
  const source = read(`japanese-${quality}.glb`), active = read(`japanese-continuous-${quality}.glb`);
  const report = receipt.reports.find((entry: { quality: string }) => entry.quality === quality);
  expect(createHash("sha256").update(source.bytes).digest("hex")).toBe(report.sourceSha256);
  expect(createHash("sha256").update(active.bytes).digest("hex")).toBe(report.sha256);
  expect(active.json.nodes).toEqual(source.json.nodes);
  expect(active.json.materials).toEqual(source.json.materials);
  expect(active.json.images).toEqual(source.json.images);
  expect(active.json.meshes).toHaveLength(source.json.meshes.length);
  let triangles = 0;
  source.json.meshes.forEach((mesh: any, meshIndex: number) => mesh.primitives.forEach((part: any, primitiveIndex: number) => {
    const repaired = active.json.meshes[meshIndex].primitives[primitiveIndex];
    expect(repaired.material).toBe(part.material);
    for (const attribute of Object.keys(part.attributes)) {
      const originalValues = values(source, part.attributes[attribute]);
      expect(values(active, repaired.attributes[attribute]).slice(0, originalValues.length)).toEqual(originalValues);
    }
    const originalIndices = values(source, part.indices);
    expect(values(active, repaired.indices).slice(0, originalIndices.length)).toEqual(originalIndices);
    triangles += active.json.accessors[repaired.indices].count / 3;
  }));
  for (const image of source.json.images) {
    const view = source.json.bufferViews[image.bufferView], start = view.byteOffset ?? 0;
    expect(active.binary.subarray(start, start + view.byteLength)).toEqual(source.binary.subarray(start, start + view.byteLength));
  }
  expect(triangles).toBe(MONUMENT_ASSETS.japanese[quality]);
  expect(active.bytes.length).toBeLessThan(10_000_000);
  expect(sourceBands(source)).toEqual(Array(11).fill(false));
  expect(sourceBands(active)).toEqual(Array(11).fill(true));
}, 60_000);

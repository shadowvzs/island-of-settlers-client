import { expect, it } from "vitest";

import { repairRetainedWellAnimationChannels } from "../tools/bench/building-export-retained-well";

const encode = (json: unknown) => {
  const text = new TextEncoder().encode(JSON.stringify(json)), length = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(20 + length + 16), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + length); bytes.set(text, 20);
  view.setUint32(20 + length, 8, true); view.setUint32(24 + length, 0x004e4942, true);
  bytes.set([13, 27, 41, 55, 69, 83, 97, 111], 28 + length);
  return bytes;
};
const fixture = () => ({ nodes: [{ name: "roman_35", extras: { buildingId: 35, nation: "roman" }, children: [1] },
  { name: "unchanged_geometry", mesh: 0 }], meshes: [{ name: "unchanged_mesh" }], materials: [{ name: "stone" }],
  accessors: [{ type: "VEC3" }, { type: "VEC4" }], animations: [
    { name: "roman_35_construction", samplers: [{ output: 0 }], channels: [
      ...Array.from({ length: 5 }, () => ({ sampler: 0, target: { node: 1, path: "scale" } })),
      { sampler: 0, target: { path: "scale" } }] },
    { name: "roman_35_door", samplers: [{ output: 1 }], channels: [{ sampler: 0, target: { path: "rotation" } }] }] });
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes.subarray(20,
  20 + new DataView(bytes.buffer).getUint32(12, true))));

it("repairs only the known pair with an empty anchor, preserving all binary payload bytes and static asset data", () => {
  const original = fixture(), bytes = encode(original), saved = bytes.slice();
  const result = repairRetainedWellAnimationChannels(bytes, "roman"), json = decode(result.bytes);
  expect(result.repaired).toBe(2); expect(bytes).toEqual(saved);
  expect(json.nodes[2]).toEqual({ name: "roman_35_hidden_door_anchor", extras: { exportHiddenDoorAnchor: true } });
  expect(json.meshes).toEqual(original.meshes); expect(json.materials).toEqual(original.materials);
  expect(json.accessors).toEqual(original.accessors);
  expect(json.animations[0].channels[5].target.node).toBe(2);
  expect(json.animations[1].channels[0].target.node).toBe(2);
  expect(result.bytes.slice(-16)).toEqual(saved.slice(-16));
  expect(repairRetainedWellAnimationChannels(result.bytes, "roman").bytes).toBe(result.bytes);
});

it("refuses unrelated missing channels or a mismatched national root", () => {
  const json = fixture(); json.animations[1]!.name = "roman_18_door";
  expect(() => repairRetainedWellAnimationChannels(encode(json), "roman")).toThrow("Unexpected unbound channel");
  const wrongRoot = fixture(); wrongRoot.nodes[0]!.name = "viking_35";
  expect(() => repairRetainedWellAnimationChannels(encode(wrongRoot), "roman")).toThrow("Missing canonical Well35");
});

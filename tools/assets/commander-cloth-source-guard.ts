import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { Document, NodeIO } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { riderVertexAttributeKeys } from "./mount-surface-lod";

export const VIKING_CLOTH_VERTICES = [137, 151, 152, 167, 168, 169, 780, 783, 791, 1548, 1556] as const;
export const VIKING_CLOTH_SOURCE_SHA = "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907";
export const VIKING_CLOTH_STAGE_SHA = "ffa8a45278818facdf474f95cc13fc911a46d50a89868cf550744e59c57d1895";
type Record = { vertex: number; joints: number[]; values: number[]; jointNames: string[] };
export type VikingClothProfile = { inputHash: string; records: Record[] };

export const commanderRiderIdentity = async (io: NodeIO, doc: Document) => {
  const { json } = await io.writeJSON(doc);
  return { materials: json.materials, nodes: json.nodes, samplers: json.samplers, textures: json.textures,
    meshes: doc.getRoot().listMeshes().map(mesh => ({ name: mesh.getName(), primitives: mesh.listPrimitives().map(primitive => ({
      mode: primitive.getMode(), material: doc.getRoot().listMaterials().indexOf(primitive.getMaterial()!) })) })),
    images: doc.getRoot().listTextures().map(texture => createHash("sha256").update(texture.getImage()!).digest("hex")),
    skins: doc.getRoot().listSkins().map(skin => ({ name: skin.getName(), joints: skin.listJoints().map(joint => joint.getName()),
      inverse: Array.from(skin.getInverseBindMatrices()!.getArray()!) })) };
};

/** The exception covers eleven original cloth skin entries only; every other decoded stream stays exact. */
export const guardCommanderClothSource = async (io: NodeIO, source: Document, candidate: Document, profile: VikingClothProfile) => {
  assert.equal(profile.inputHash, VIKING_CLOTH_SOURCE_SHA);
  assert.deepEqual(profile.records.map(record => record.vertex).sort((a, b) => a - b), [...VIKING_CLOTH_VERTICES]);
  assert.deepEqual(await commanderRiderIdentity(io, candidate), await commanderRiderIdentity(io, source));
  const originals = source.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  const targets = candidate.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  assert.equal(originals.length, targets.length);
  const records = new Map(profile.records.map(record => [record.vertex, record]));
  for (const [index, original] of originals.entries()) {
    const target = targets[index]!;
    assert.deepEqual(target.listSemantics().sort(), original.listSemantics().sort());
    assert.deepEqual(Array.from(target.getIndices()!.getArray()!), Array.from(original.getIndices()!.getArray()!));
    for (const semantic of original.listSemantics()) {
      const before = original.getAttribute(semantic)!, after = target.getAttribute(semantic)!;
      assert.equal(after.getCount(), before.getCount()); assert.equal(after.getElementSize(), before.getElementSize());
      const scratch = Array(before.getElementSize()).fill(0);
      for (let vertex = 0; vertex < before.getCount(); vertex++) {
        const actual = after.getElement(vertex, scratch).slice(), record = index === 1 ? records.get(vertex) : undefined;
        if (record && (semantic === "JOINTS_0" || semantic === "WEIGHTS_0")) {
          const expected = semantic === "JOINTS_0" ? record.joints : record.values;
          assert(actual.every((value, channel) => Math.abs(value - expected[channel]!) <= (semantic === "JOINTS_0" ? 0 : 1 / 65535)),
            "Only the explicitly accepted original-rig skin binding is permitted");
        } else assert.deepEqual(actual, before.getElement(vertex, scratch).slice(), `Unchanged ${index}/${semantic}/${vertex}`);
      }
    }
  }
  const cloth = targets[1]!, keys = riderVertexAttributeKeys(cloth);
  const skin = candidate.getRoot().listNodes().find(node => node.getMesh()?.listPrimitives().includes(cloth))!.getSkin()!;
  for (const record of profile.records) assert.deepEqual(record.joints.map(joint => skin.listJoints()[joint]!.getName()), record.jointNames);
  return new Set(VIKING_CLOTH_VERTICES.map(vertex => keys[vertex]!));
};

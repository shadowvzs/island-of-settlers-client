import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";

export interface ClothSkinRecord { vertex: number; joints: number[]; values: number[] }

/** Private immutable derivative; authorize only explicit cloth skin records, never source/body edits. */
export const writeGuardedClothStage = async (source: string, destination: string, records: ClothSkinRecord[]) => {
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const sourceSha256 = hash(source), io = await createRetargetIO(), document = await io.read(source);
  assert.equal(sourceSha256, "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907");
  assert(!existsSync(destination), "Never overwrite an immutable private review stage");
  const metadata = async (item: typeof document) => ({
    nodes: (await io.writeJSON(item)).json.nodes,
    skins: item.getRoot().listSkins().map(skin => ({ joints: skin.listJoints().map(node => node.getName()),
      inverseBinds: Array.from(skin.getInverseBindMatrices()!.getArray()!) })),
    images: item.getRoot().listTextures().map(texture => ({ name: texture.getName(), mime: texture.getMimeType(),
      sha256: createHash("sha256").update(texture.getImage()!).digest("hex") })),
    materials: (await io.writeJSON(item)).json.materials
  });
  const originalMetadata = await metadata(document);
  const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  const storage = (accessor: NonNullable<ReturnType<typeof primitives[number]["getIndices"]>>) => ({
    componentType: accessor.getComponentType(), count: accessor.getCount(), normalized: accessor.getNormalized(),
    type: accessor.getType() });
  const streams = primitives.map(primitive => ({ indices: Array.from(primitive.getIndices()!.getArray()!),
    indexStorage: storage(primitive.getIndices()!),
    attributes: primitive.listSemantics().map(name => ({ name, storage: storage(primitive.getAttribute(name)!),
      values: Array.from(primitive.getAttribute(name)!.getArray()!) })) }));
  const affected = new Set(records.map(record => record.vertex));
  assert.equal(affected.size, records.length);
  for (const record of records) {
    assert.equal(record.joints.length, 4); assert.equal(record.values.length, 4);
    assert(record.values.every(value => value >= 0 && value <= 1));
    assert(Math.abs(record.values.reduce((sum, value) => sum + value, 0) - 1) < .0001);
    primitives[1]!.getAttribute("JOINTS_0")!.setElement(record.vertex, record.joints);
    primitives[1]!.getAttribute("WEIGHTS_0")!.setElement(record.vertex, record.values);
  }
  const expected = ["JOINTS_0", "WEIGHTS_0"].map(name => ({ name,
    values: Array.from(primitives[1]!.getAttribute(name)!.getArray()!) }));
  await io.write(destination, document);
  const written = await io.read(destination);
  assert.deepEqual(await metadata(written), originalMetadata);
  written.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).forEach((primitive, index) => {
    assert.deepEqual(Array.from(primitive.getIndices()!.getArray()!), streams[index]!.indices);
    assert.deepEqual(storage(primitive.getIndices()!), streams[index]!.indexStorage);
    for (const stream of streams[index]!.attributes) {
      assert.deepEqual(storage(primitive.getAttribute(stream.name)!), stream.storage,
        "Guarded cloth staging must preserve original normalized integer storage and component types");
      if (index === 1 && ["JOINTS_0", "WEIGHTS_0"].includes(stream.name)) {
        const attribute = primitive.getAttribute(stream.name)!, size = attribute.getElementSize(), values = attribute.getArray()!;
        for (let vertex = 0; vertex < attribute.getCount(); vertex++) if (!affected.has(vertex))
          assert.deepEqual(Array.from(values.slice(vertex * size, (vertex + 1) * size)),
            stream.values.slice(vertex * size, (vertex + 1) * size));
        assert.deepEqual(Array.from(values), expected.find(skin => skin.name === stream.name)!.values);
      } else assert.deepEqual(Array.from(primitive.getAttribute(stream.name)!.getArray()!), stream.values);
    }
  });
  assert.equal(hash(source), sourceSha256);
  return { source, sourceSha256, destination, candidateSha256: hash(destination), originalBodyPrimitiveExact: true,
    allRestNormalUvTopologyExact: true, allRigMaterialsTexturesExact: true,
    modifiedSkinPrimitive: 1, modifiedClothVertices: records.map(record => record.vertex),
    publicationAllowed: false, nativeAccepted: false, reviewOnly: true };
};

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { type Document, NodeIO } from "../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS } from "../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import { dequantize, weld } from "../../island-of-settlers-worker-generation/node_modules/@gltf-transform/functions/dist/index.js";
import { MeshoptDecoder, MeshoptEncoder } from "../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { COMMANDER_RIDER_GEOMETRY_BYTES, COMMANDER_RIDER_TRIANGLES } from "../tools/assets/commander-surface-policy";
import { mountVertexSignatures } from "../tools/assets/mount-hand-lod";
import { riderFaceAttributeKeys, riderFaceAttributes } from "../tools/assets/mount-surface-lod";

beforeAll(async () => { await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]); });
it.each([["nubian", "nubian-man-kilt"], ["viking", "viking-woman-blue"]])(
  "preserves %s original critical surfaces, rig and materials in the actual runtime Commander body", async (nation, body) => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder
    });
    const source = await io.read(resolve(`../island-of-settlers-worker-generation/game_ready/mounts/riders/${body}/model.glb`));
    const runtime = await io.read(resolve(`assets/mounts/${nation}-commander-surface.glb`));
    const identity = async (doc: Document) => {
      const { json } = await io.writeJSON(doc);
      return { materials: json.materials, nodes: json.nodes, samplers: json.samplers, textures: json.textures,
        bindings: doc.getRoot().listMeshes().map(mesh => mesh.listPrimitives().map(primitive =>
          doc.getRoot().listMaterials().indexOf(primitive.getMaterial()!))),
        skins: doc.getRoot().listSkins().map(skin => ({ joints: skin.listJoints().map(joint => joint.getName()),
          inverse: Array.from(skin.getInverseBindMatrices()!.getArray()!) })),
        images: doc.getRoot().listTextures().map(texture => createHash("sha256").update(texture.getImage()!).digest("hex")) };
    };
    expect(await identity(runtime)).toEqual(await identity(source));
    await source.transform(dequantize(), weld());
    const targetPrimitives = runtime.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
    let triangles = 0, criticalFaces = 0;
    for (const [meshIndex, mesh] of source.getRoot().listMeshes().entries()) {
      const skin = source.getRoot().listNodes().find(node => node.getMesh() === mesh)!.getSkin()!;
      const critical = new Set(skin.listJoints().flatMap((joint, index) =>
        /^(Head|Neck|(Left|Right)(Arm|ForeArm|Hand))/.test(joint.getName()) ? [index] : []));
      expect(critical.size).toBeGreaterThan(4);
      for (const [primitiveIndex, original] of mesh.listPrimitives().entries()) {
        const offset = source.getRoot().listMeshes().slice(0, meshIndex).reduce((sum, item) => sum + item.listPrimitives().length, 0);
        const target = targetPrimitives[offset + primitiveIndex]!, sourceVertices = mountVertexSignatures(original);
        for (const vertex of mountVertexSignatures(target)) expect(sourceVertices.has(vertex)).toBe(true);
        const keys = riderFaceAttributeKeys(original), faces = riderFaceAttributes(target), indices = original.getIndices()!;
        const joints = original.getAttribute("JOINTS_0")!, weights = original.getAttribute("WEIGHTS_0")!;
        const ids = [0, 0, 0, 0], values = [0, 0, 0, 0];
        for (let face = 0; face < keys.length; face++) {
          let protectedFace = false;
          for (let corner = 0; corner < 3; corner++) {
            const vertex = indices.getScalar(face * 3 + corner);
            joints.getElement(vertex, ids); weights.getElement(vertex, values);
            if (ids.some((id, channel) => values[channel]! > 0 && critical.has(id))) protectedFace = true;
          }
          if (!protectedFace) continue;
          expect(faces.has(keys[face]!)).toBe(true); criticalFaces++;
        }
        triangles += target.getIndices()!.getCount() / 3;
      }
    }
    expect(criticalFaces).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(COMMANDER_RIDER_TRIANGLES);
    const bytes = runtime.getRoot().listAccessors().reduce((sum, accessor) => sum + (accessor.getArray()?.byteLength ?? 0), 0);
    expect(bytes).toBeLessThanOrEqual(COMMANDER_RIDER_GEOMETRY_BYTES);
  });

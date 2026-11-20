import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PerspectiveCamera, type SkinnedMesh, Vector3 } from "three";

import { skinnedNode } from "../../../island-of-settlers-worker-generation/src/armour/armour-gltf";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const root = resolve("../resources/project-reviews/armour-shared-repair-2026-11-02");
const output = resolve(root, "source-cloth-skin-v-literal-diagnostic");
const ready = resolve("../island-of-settlers-worker-generation/game_ready"), id = "nubian-man-scarf";
const sourcePath = resolve(ready, "original-clothes-review", id, "model.glb");
const candidatePath = resolve(ready, "source-cloth-profile-v-literal-diagnostic", id, "model.glb");
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const sourceSha256 = await hash(sourcePath), candidateSha256 = await hash(candidatePath);
const io = await createRetargetIO(), document = await io.read(sourcePath), primitive = skinnedNode(document).getMesh()!.listPrimitives()[0]!;
assert.equal(primitive.getAttribute("POSITION")!.getCount(), 11505);
assert.equal(primitive.getIndices()!.getCount(), 30258);
const indices = Array.from(primitive.getIndices()!.getArray()!);
const support = buildSourceKiltPanels(await io.read(sourcePath), id);
assert.deepEqual(Array.from(primitive.getIndices()!.getArray()!), indices);
const costume = new Set(support.referenceTriangleOffsets.map(at => at / 3));
const legs = new Set(support.originalLegVertices), uv = primitive.getAttribute("TEXCOORD_0")!;
const material = primitive.getMaterial()!, texture = material.getBaseColorTexture()!;
await writeFile(resolve(output, "original-albedo.bin"), texture.getImage()!);
const sourceTextures = [];
for (const [name, map] of [["normal", material.getNormalTexture()], ["occlusion", material.getOcclusionTexture()],
  ["metallic-roughness", material.getMetallicRoughnessTexture()]] as const) if (map?.getImage()) {
  await writeFile(resolve(output, `original-${name}.bin`), map.getImage()!);
  sourceTextures.push({ name, mime: map.getMimeType() });
}
const native = JSON.parse(await readFile(resolve(output, "review.json"), "utf8"));
const probes = [
  { troop: "shield", motion: "idle front", pixel: [105, 304] },
  { troop: "heavy", motion: "idle front", pixel: [93, 302] },
  { troop: "archer", motion: "idle front", pixel: [91, 296] },
  { troop: "shield", motion: "run front", pixel: [141, 302] },
  { troop: "shield", motion: "run back", pixel: [159, 319] },
  { troop: "archer", motion: "windup front", pixel: [80, 279] },
];
const positions = (body: SkinnedMesh) => Array.from({ length: 11505 }, (_, vertex) => body.applyBoneTransform(vertex,
  new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex)).applyMatrix4(body.matrixWorld));
const assets = await createHatchAuditAssets(), records = [];
try {
  for (const state of ["original-clothes", "candidate"]) {
    const worker = await assets.pack.load("nubian", id, pathToFileURL(state === "candidate" ? candidatePath : sourcePath).href);
    const body = worker.root.getObjectByName("body") as SkinnedMesh;
    const saved = native.records.find((record: { quality: string; state: string; waist: boolean }) =>
      record.quality === "high" && record.state === state && record.waist);
    for (const probe of probes) {
      const cell = saved.cells.find((cell: { troop: string; name: string }) => cell.troop === probe.troop && cell.name === probe.motion);
      assert(cell);
      applyArmourPoseSnapshot(worker.root, cell.diagnostics);
      const grid = new TriangleGrid(positions(body), indices), camera = new PerspectiveCamera(32, 1, .01, 20);
      camera.position.set(Math.sin(cell.angle) * .85, .65, Math.cos(cell.angle) * .85);
      camera.lookAt(0, .45, 0); camera.updateMatrixWorld(true);
      const direction = new Vector3((probe.pixel[0]! + .5) / 160 - 1, 1 - (probe.pixel[1]! + .5) / 160, .5)
        .unproject(camera).sub(camera.position).normalize();
      const hit = grid.raycast(camera.position, direction, .001, 3,
        hit => material.getDoubleSided() || hit.facing < 0);
      let surface;
      if (hit) {
        const vertices = indices.slice(hit.triangle * 3, hit.triangle * 3 + 3), textureUv = [0, 0];
        vertices.forEach((vertex, corner) => uv.getElement(vertex, []).forEach((value, axis) => {
          textureUv[axis]! += value * hit.bary[corner]!;
        }));
        let role = "other-original-body";
        if (vertices.every(vertex => legs.has(vertex))) role = "original-leg";
        if (costume.has(hit.triangle)) role = "original-costume";
        surface = { face: hit.triangle, vertices, uv: textureUv, facing: hit.facing,
          originalNormals: vertices.map(vertex => primitive.getAttribute("NORMAL")!.getElement(vertex, [])),
          role };
      }
      records.push({ state, ...probe, surface });
    }
    worker.dispose();
  }
} finally { assets.restore(); }
assert.equal(await hash(sourcePath), sourceSha256); assert.equal(await hash(candidatePath), candidateSha256);
await writeFile(resolve(output, "visible-mark-surface-audit.json"), JSON.stringify({ sourceSha256, candidateSha256,
  doubleSided: material.getDoubleSided(), textureMime: texture.getMimeType(), sourceTextures,
  baseColorFactor: material.getBaseColorFactor(), occlusionStrength: material.getOcclusionStrength(),
  normalScale: material.getNormalScale(), metallicFactor: material.getMetallicFactor(), records,
  scope: "Read-only visible hem-mark rays from actual saved native camera/pose; whole source body, excluding props. Original streams/texture unchanged." }, null, 2));
console.log(JSON.stringify(records));

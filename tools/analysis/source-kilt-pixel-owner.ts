import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { PerspectiveCamera, Raycaster, type SkinnedMesh, Vector2, Vector3 } from "three";

import { decodeEyeImage, sampleEyeImage } from "../../../island-of-settlers-worker-generation/src/national-workers/eye-albedo";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { folder: { type: "string" }, image: { type: "string" }, out: { type: "string" } } });
if (!values.folder || !/^[a-z0-9-]+$/.test(values.folder) || !values.out)
  throw new Error("Choose an explicit source-clothes stage and pixel ownership receipt");
const folder = values.folder, id = "nubian-man-scarf";
const ready = resolve("../island-of-settlers-worker-generation/game_ready");
const path = resolve(ready, folder, id, "model.glb");
const receipt = JSON.parse(await readFile(resolve(path, "..", "provenance.json"), "utf8"));
const frames = await createEquippedCpuFrames({ folder: "armour", bodies: [id], ranks: ["recruit"],
  qualities: ["high"], sourceFolder: folder });
if (frames.records[0]!.modelSha256 !== receipt.outputSha256) throw new Error("Pixel ownership model SHA changed");
const assets = await createHatchAuditAssets(), io = await createRetargetIO(), records = [];
try {
  const document = await io.read(path), texture = document.getRoot().listTextures()[0]!;
  const image = await decodeEyeImage(texture), worker = await assets.pack.load("nubian", id, pathToFileURL(path).href);
  const rendered = values.image ? await decodeEyeImage(document.createTexture("diagnostic_png_read_only")
    .setImage(await readFile(values.image)).setMimeType("image/png")) : undefined;
  worker.root.scale.setScalar(WORKER_SCALE); worker.root.updateMatrixWorld(true);
  const mesh = worker.root.getObjectByName("body") as SkinnedMesh;
  const originalCount = mesh.geometry.getAttribute("position").count - receipt.appendedVertices;
  const legVertices = new Set<number>(receipt.originalLegVertices);
  const camera = new PerspectiveCamera(32, 1, .01, 20), ray = new Raycaster();
  camera.position.set(Math.sin(.18) * .85, .65, Math.cos(.18) * .85);
  camera.lookAt(0, .45, 0); camera.updateMatrixWorld(true);
  for (const motion of ["attack/9/12", "run/6/8"]) {
    const cell = frames.records[0]!.cells.find(cell => cell.troop === "heavy" && cell.name === motion)!;
    applyArmourPoseSnapshot(worker.root, cell.diagnostics); mesh.computeBoundingSphere();
    for (const y of [110, 140, 170, 200, 230]) for (const x of [100, 120, 140, 160, 180]) {
      ray.setFromCamera(new Vector2(x / 160 - 1, 1 - y / 160), camera);
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit?.face || !hit.uv) continue;
      const face = [hit.face.a, hit.face.b, hit.face.c];
      let owner = "retained-original-or-waist-boundary";
      if (face.every(vertex => vertex >= originalCount)) owner = "new-source-kilt-panel";
      else if (face.every(vertex => legVertices.has(vertex))) owner = "retained-original-leg-surface";
      const posed = face.map(vertex => mesh.applyBoneTransform(vertex,
        new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld));
      const normal = posed[1]!.clone().sub(posed[0]!).cross(posed[2]!.clone().sub(posed[0]!)).normalize();
      records.push({ motion, pixel: [x, y], owner, faceIndex: hit.faceIndex, face, point: hit.point.toArray(),
        uv: hit.uv.toArray(), albedo: sampleEyeImage(image, hit.uv.x, hit.uv.y), normal: normal.toArray(),
        rendered: rendered && sampleEyeImage(rendered, ((motion === "run/6/8" ? 5 : 2) * 320 + x + .5) / rendered.width,
          (320 + y + .5) / rendered.height) });
    }
  }
  worker.dispose();
} finally { assets.restore(); }
await writeFile(values.out, JSON.stringify({ scope: "CPU ray attribution at the exact native waist camera and production equipped pose. Rays intersect the body only; selected lower-skirt pixels have no foreground prop. Encoded original albedo sampled read-only. Ownership is evidence for diagnosis, never anatomical deletion authority.",
  modelSha256: receipt.outputSha256, records }, null, 2));
console.log(JSON.stringify(records.filter(record => record.pixel[0] === 140 || record.pixel[0] === 160)));

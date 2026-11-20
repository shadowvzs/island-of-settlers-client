import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { PerspectiveCamera, Raycaster, type SkinnedMesh, Vector2, Vector3 } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { folder: { type: "string" }, out: { type: "string" } } });
if (!values.folder || !/^[a-z0-9-]+$/.test(values.folder) || !values.out)
  throw new Error("Choose an explicit clean-surface pack and diagnostic receipt");
const folder = values.folder, id = "nubian-man-scarf";
const provenance = JSON.parse(await readFile(resolve("../island-of-settlers-worker-generation/game_ready",
  folder, "nubian", id, "source-kilt.json"), "utf8"));
const frames = await createEquippedCpuFrames({ folder, bodies: [id], ranks: ["recruit"], qualities: ["high"] });
if (frames.records[0]!.modelSha256 !== provenance.outputSha256) throw new Error("Diagnostic source SHA changed");
const assets = await createHatchAuditAssets({ armourFolder: folder }), records = [], seams = [];
try {
  const worker = await assets.soldier("nubian", id, "recruit", false);
  worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(0); worker.root.updateMatrixWorld(true);
  const body = worker.root.getObjectByName("body") as SkinnedMesh;
  const cloth = worker.root.getObjectByName("armour_underclothes_lod0") as SkinnedMesh;
  const inactive = worker.root.getObjectByName("armour_underclothes_lod1");
  if (!cloth?.isSkinnedMesh || !cloth.visible || inactive?.visible) throw new Error("LOD ownership is incorrect");
  const camera = new PerspectiveCamera(32, 1, .01, 20), ray = new Raycaster();
  camera.position.set(Math.sin(.18) * .85, .65, Math.cos(.18) * .85);
  camera.lookAt(0, .45, 0); camera.updateMatrixWorld(true);
  const legVertices = new Set<number>(provenance.originalLegVertices);
  for (const motion of ["attack/9/12", "run/6/8"]) {
    const cell = frames.records[0]!.cells.find(cell => cell.troop === "heavy" && cell.name === motion)!;
    applyArmourPoseSnapshot(worker.root, cell.diagnostics);
    [body, cloth].forEach(mesh => mesh.computeBoundingSphere());
    const { columns, rows } = provenance.lods[0].sourceProfile, partVertices = (rows + 1) * (columns + 1);
    const boundary = (side: number) => Array.from({ length: rows + 1 }, (_, row) => {
      let vertex = row * (columns + 1);
      if (side === 1) vertex += partVertices + columns;
      const world = cloth.applyBoneTransform(vertex,
        new Vector3().fromBufferAttribute(cloth.geometry.getAttribute("position"), vertex)).applyMatrix4(cloth.matrixWorld);
      const screen = world.clone().project(camera);
      return { row, vertex, world: world.toArray(), pixel: [(screen.x + 1) * 160, (1 - screen.y) * 160] };
    });
    seams.push({ motion, leftFront: boundary(0), rightFront: boundary(1) });
    for (const y of [110, 140, 170, 200, 230, 260]) for (const x of [100, 120, 140, 160, 180]) {
      ray.setFromCamera(new Vector2(x / 160 - 1, 1 - y / 160), camera);
      const hits = ray.intersectObjects([body, cloth], false).flatMap(hit => {
        if (!hit.face) return [];
        const mesh = hit.object as SkinnedMesh, face = [hit.face.a, hit.face.b, hit.face.c];
        const rest = face.map(vertex => new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex));
        const posed = face.map((vertex, corner) => mesh.applyBoneTransform(vertex, rest[corner]!.clone())
          .applyMatrix4(mesh.matrixWorld));
        let owner = "retained-original-body";
        if (mesh === cloth) owner = "clean-wrap";
        else if (face.every(vertex => legVertices.has(vertex))) owner = "retained-original-leg";
        let panel: string | undefined;
        if (mesh === cloth) panel = (hit.faceIndex ?? 0) < mesh.geometry.index!.count / 6 ? "left" : "right";
        return [{ owner, panel, mesh: mesh.name, distance: hit.distance, faceIndex: hit.faceIndex, face,
          point: hit.point.toArray(), uv: hit.uv?.toArray(), rest: rest.map(point => point.toArray()),
          normal: posed[1]!.clone().sub(posed[0]!).cross(posed[2]!.clone().sub(posed[0]!)).normalize().toArray() }];
      });
      if (hits.length) records.push({ motion, pixel: [x, y], hits });
    }
  }
  worker.dispose();
} finally { assets.restore(); }
await writeFile(values.out, JSON.stringify({ scope: "Exact native waist camera/production pose ray attribution of retained original body and the single active clean garment LOD. No prop ray, texture repaint or geometry change.",
  modelSha256: provenance.outputSha256, records, seams }, null, 2));
console.log(JSON.stringify(records.filter(record => record.pixel[0] === 140)
  .map(record => ({ motion: record.motion, pixel: record.pixel, hits: record.hits.slice(0, 2) }))));

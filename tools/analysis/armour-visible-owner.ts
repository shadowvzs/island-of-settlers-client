import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Mesh, type Object3D, PerspectiveCamera, Raycaster, type SkinnedMesh, Vector2 } from "three";

import type { ArmourRank } from "../../../island-of-settlers-worker-generation/src/game-three-armour";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

/** Read-only owner lookup for local320px cells from armour-fit-review, excluding equipment props. */
const { values: options } = parseArgs({ options: {
  body: { type: "string", default: "japanese-man-grey" }, close: { type: "boolean" },
  folder: { type: "string", default: "armour-local-neck-r" }, minimal: { type: "boolean" },
  out: { type: "string" }, pixels: { type: "string", default: "133,242" },
  rank: { type: "string", default: "recruit" }, troop: { type: "string", default: "archer" },
  view: { type: "string", default: "3" },
} });
const views = [
  { name: "idle front", action: "idle_breathe", progress: null, phase: .2, angle: .18 },
  { name: "windup front", action: "idle_breathe", progress: .48, phase: .2, angle: .18 },
  { name: "impact front", action: "idle_breathe", progress: .75, phase: .2, angle: .18 },
  { name: "impact back", action: "idle_breathe", progress: .75, phase: .2, angle: Math.PI + .25 },
  { name: "walk side", action: "walk", progress: null, phase: .23, angle: Math.PI / 2 - .25 },
];
const view = views[Number(options.view)];
assert(view, "A native gallery view index0–4 is required");
const nation = options.body.split("-")[0] as WorkerNation;
const native = await loadCatapultCpuPoser();
const assets = await createHatchAuditAssets({ armourFolder: options.folder });
const originalNow = performance.now.bind(performance);
let clock = originalNow();
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
const visible = (node: Object3D) => {
  for (let owner: Object3D | null = node; owner; owner = owner.parent) if (!owner.visible) return false;
  return true;
};
const weightsOf = (mesh: SkinnedMesh, vertex: number) => {
  if (!mesh.isSkinnedMesh) return [];
  const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
  return [0, 1, 2, 3].flatMap(slot => {
    const weight = weights.getComponent(vertex, slot);
    return weight ? [[mesh.skeleton.bones[joints.getComponent(vertex, slot)]!.name, weight]] : [];
  });
};
try {
  const worker = await assets.soldier(nation, options.body, options.rank as ArmourRank, Boolean(options.minimal));
  worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(options.minimal ? 1 : 0);
  const pose = native.createWorkerPoser(worker);
  const frame = { actorId: 1, nation, variant: options.body, x: 0, y: 0, z: 0, heading: 0,
    selected: false, visible: true, action: view.action, gaitPhase: view.phase,
    runBlend: 0, animationTime: view.phase * 3, target: null, workerJob: "Soldier",
    workerTool: { shield: "sword", heavy: "axe", archer: "bow" }[options.troop],
    armourRank: options.rank, carryingWare: null,
    combat: { attackProgress: view.progress, defending: false, doorMelee: false,
      faction: 0, type: options.troop, variant: 0 } } as WorkerFrame;
  for (let tick = 0; tick < 4; tick++) { clock += 1000; pose(frame); }
  worker.root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  worker.root.traverse(node => {
    if ((node as Mesh).isMesh && visible(node)) meshes.push(node as Mesh);
  });
  const camera = new PerspectiveCamera(32, 1, .01, 20), distance = options.close ? .95 : 2.15;
  camera.position.set(Math.sin(view.angle) * distance, .88, Math.cos(view.angle) * distance);
  camera.lookAt(0, options.close ? .78 : .65, 0); camera.updateMatrixWorld(true);
  const ray = new Raycaster(), records = [];
  for (const pair of options.pixels.split(";")) {
    const pixel = pair.split(",").map(Number);
    assert(pixel.length === 2 && pixel.every(Number.isFinite), "Pixels use x,y;x,y local320px coordinates");
    ray.setFromCamera(new Vector2(pixel[0]! / 160 - 1, 1 - pixel[1]! / 160), camera);
    const hits = ray.intersectObjects(meshes, false);
    records.push({ pixel, hits: hits.slice(0, 4).map(hit => {
      const mesh = hit.object as SkinnedMesh, face = hit.face!;
      const material = Array.isArray(mesh.material) ? mesh.material[face.materialIndex] : mesh.material;
      const vertices = [face.a, face.b, face.c], uv = mesh.geometry.getAttribute("uv");
      const owners: string[] = [];
      for (let owner: Object3D | null = mesh; owner; owner = owner.parent) if (owner.name) owners.push(owner.name);
      return { distance: hit.distance, face: hit.faceIndex, material: material?.name, owners,
        point: hit.point.toArray(), uv: hit.uv?.toArray(),
        triangleUvs: vertices.map(vertex => [uv.getX(vertex), uv.getY(vertex)]),
        vertices, weights: vertices.map(vertex => weightsOf(mesh, vertex)) };
    }) });
  }
  const output = resolve(options.out ??
    `../resources/project-reviews/armour-shared-repair-2026-11-02/${options.body}-visible-owner-cpu.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ scope: "Exact native camera/poser; equipment props excluded; no mutations",
    options, view, sourceHashes: Object.fromEntries(assets.assets), records }, null, 2));
  console.log(JSON.stringify(records.map(({ hits, pixel }) => ({ pixel,
    hit: hits[0] && { owners: hits[0].owners, material: hits[0].material, face: hits[0].face, uv: hits[0].uv } })), null, 2));
  worker.dispose();
} finally {
  assets.restore(); native.restore();
  Object.defineProperty(performance, "now", { configurable: true, value: originalNow });
}

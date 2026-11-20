import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Mesh, type Object3D, SkinnedMesh, Vector3 } from "three";

import { fitArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/body-fit";
import { repairUnweightedVertices } from "../../../island-of-settlers-worker-generation/src/armour/repair-skin-weights";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { fitComposedSash, markComposedWaistRing } from "../../../island-of-settlers-worker-generation/src/national-workers/composed-sash";
import { NATIONAL_WORKER_DESIGNS } from "../../../island-of-settlers-worker-generation/src/national-workers/design";
import { readWorkerLayerSurface } from "../../../island-of-settlers-worker-generation/src/national-workers/skinned-surface";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

/** Published inputs plus an optional in-memory prototype; never writes worker assets. */
const refit = process.env.REFIT_SASH === "1";
const selected = new Set((process.env.BODIES ?? "chinese-male-1,chinese-female-3").split(","));
const designs = NATIONAL_WORKER_DESIGNS.filter(design => design.nation === "chinese" && selected.has(design.id));
const ready = resolve("../island-of-settlers-worker-generation/game_ready");
const io = await createRetargetIO(), fits = new Map<string, ReturnType<typeof fitArmourBody>>();
for (const design of designs) {
  const document = await io.read(`${ready}/tripo/${design.source}/model.glb`);
  repairUnweightedVertices(document); fits.set(design.id, fitArmourBody(document));
}
const native = await loadCatapultCpuPoser();
const assets = await createHatchAuditAssets({ transformModel: (document, path) => {
  const design = designs.find(candidate => path.includes(`/${candidate.id}/model`));
  if (!design) return;
  const fit = fits.get(design.id)!;
  if (refit) { fitComposedSash(document, fit); return; }
  const node = document.getRoot().listNodes().find(node => node.getName() === "faction_sash")!;
  markComposedWaistRing(document, node, readWorkerLayerSurface(document, node, fit.body), fit.torso.scale);
} });
const originalNow = performance.now.bind(performance);
let clock = originalNow();
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });

const namedOwner = (node: Object3D, expression: RegExp): boolean => {
  for (let owner: Object3D | null = node; owner; owner = owner.parent)
    if (expression.test(owner.name)) return true;
  return false;
};
const vertexPoint = (mesh: Mesh, vertex: number) => {
  const point = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex);
  if (mesh instanceof SkinnedMesh || "applyBoneTransform" in mesh)
    (mesh as SkinnedMesh).applyBoneTransform(vertex, point);
  return point.applyMatrix4(mesh.matrixWorld);
};
const ownedCoat = (root: Object3D) => {
  const points: Vector3[] = [], indices: number[] = [];
  root.traverse(node => {
    if (!(node instanceof Mesh) && !("isMesh" in node)) return;
    const mesh = node as Mesh;
    const explicit = namedOwner(mesh, /^national_(?:garment|trousers)(?:_|$)/);
    if (!explicit && !namedOwner(mesh, /^body(?:_|$)/)) return;
    const geometry = mesh.geometry, index = geometry.index;
    const offset = points.length, count = geometry.getAttribute("position").count;
    for (let vertex = 0; vertex < count; vertex++) points.push(vertexPoint(mesh, vertex));
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geometry.groups.length ? geometry.groups
      : [{ start: 0, count: index?.count ?? count, materialIndex: 0 }];
    for (const group of groups) {
      if (!explicit && materials[group.materialIndex ?? 0]?.name !== "national_woven_cloth") continue;
      for (let at = group.start; at < group.start + group.count; at++)
        indices.push(offset + (index?.getX(at) ?? at));
    }
  });
  assert(indices.length, "No explicit owned coat/completion support");
  return new TriangleGrid(points, indices, .03);
};
const sashPoints = (root: Object3D) => {
  const points: Vector3[] = [];
  root.traverse(node => {
    if (!(node instanceof Mesh) && !("isMesh" in node)) return;
    const mesh = node as Mesh;
    if (!namedOwner(mesh, /^faction_sash(?:_|$)/)) return;
    const marker = mesh.geometry.getAttribute("_wardrobe_attachment");
    const position = mesh.geometry.getAttribute("position");
    assert(marker, "Waist ring marker must survive native glTF decoding");
    for (let vertex = 0; vertex < position.count; vertex++) {
      if (marker.getX(vertex) !== 1) continue;
      points.push(vertexPoint(mesh, vertex));
    }
  });
  assert(points.length, "No waist attachment vertices");
  return points;
};
const records = [];
try {
  for (const design of designs) for (const minimal of [false, true]) {
    const worker = await assets.civilian("chinese", design.id, minimal);
    worker.root.scale.setScalar(WORKER_SCALE);
    const pose = native.createWorkerPoser(worker), actions = [];
    for (const action of ["walk", "carry_back", "carry_shoulder"] as const) {
      const phases = [], footPositions: number[][] = [];
      for (let sample = 0; sample < 8; sample++) {
        const phase = sample / 8;
        let carryingWare = null;
        if (action === "carry_back") carryingWare = "flour";
        if (action === "carry_shoulder") carryingWare = "logs";
        const frame = { action, actorId: 1, animationTime: phase * 3, carryingWare,
          gaitPhase: phase, heading: 0, nation: "chinese", runBlend: 0, selected: false,
          target: null, variant: design.id, visible: true, workerJob: "Carrier", x: 0, y: 0, z: 0 } as WorkerFrame;
        for (let tick = 0; tick < 3; tick++) { clock += 1000; pose(frame); }
        worker.root.updateMatrixWorld(true);
        const support = ownedCoat(worker.root), points = sashPoints(worker.root);
        const distances = points.map(point => support.closestPoint(point, .1)?.distance ?? Infinity);
        phases.push({ phase, vertices: points.length, maximumDistance: Math.max(...distances),
          beyond8mm: distances.filter(distance => distance > .008).length });
        const foot = worker.root.getObjectByName("LeftFoot")!;
        footPositions.push(foot.getWorldPosition(new Vector3()).toArray());
      }
      const first = new Vector3().fromArray(footPositions[0]!);
      const footExcursion = Math.max(...footPositions.map(point => new Vector3().fromArray(point).distanceTo(first)));
      assert(footExcursion > .02, `${design.id}/${action}: sampled gait failed to move the actual foot`);
      actions.push({ action, footExcursion, footPositions, phases });
    }
    records.push({ id: design.id, detail: minimal ? "minimal" : "high", actions });
    console.log(`${design.id}/${minimal ? "minimal" : "high"}: ${Math.max(...actions.flatMap(action =>
      action.phases.map(phase => phase.maximumDistance))).toFixed(6)}m maximum sash/coat distance`);
    worker.dispose();
  }
  const output = resolve(process.env.SASH_MOTION_OUTPUT ??
    `../resources/project-reviews/civilian-shared-cloth-2026-11-03/chinese-${refit ? "refit" : "published"}-sash-motion-cpu.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ refit, scope: "Actual native poser; explicit owned coat/completion only; no prop IK",
    sourceHashes: Object.fromEntries(assets.assets), records }, null, 2));
} finally {
  assets.restore(); native.restore();
  Object.defineProperty(performance, "now", { configurable: true, value: originalNow });
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Object3D, type SkinnedMesh, Vector3 } from "three";

import type { ArmourRank } from "../../../island-of-settlers-worker-generation/src/game-three-armour";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { clothLayerOverlap } from "./cloth-layer-overlap";

const { values: options } = parseArgs({ options: { bodies: { type: "string", default: "roman-man-grey,viking-man-blond" },
  folder: { type: "string", default: "armour-joined-sleeves-t" }, out: { type: "string" },
  quality: { type: "string", default: "high,minimal" }, ranks: { type: "string", default: "recruit,centurion" } } });
const native = await loadCatapultCpuPoser(), assets = await createHatchAuditAssets({ armourFolder: options.folder });
const originalNow = performance.now.bind(performance);
let clock = originalNow();
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
const visible = (node: Object3D) => {
  for (let parent: Object3D | null = node; parent; parent = parent.parent) if (!parent.visible) return false;
  return true;
};
const pointsOf = (mesh: SkinnedMesh) => Array.from({ length: mesh.geometry.getAttribute("position").count },
  (_, vertex) => mesh.applyBoneTransform(vertex,
    new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld));
const weightsOf = (mesh: SkinnedMesh, vertex: number) => {
  const joint = mesh.geometry.getAttribute("skinIndex"), weight = mesh.geometry.getAttribute("skinWeight");
  return [0, 1, 2, 3].flatMap(slot => weight.getComponent(vertex, slot)
    ? [[mesh.skeleton.bones[joint.getComponent(vertex, slot)]!.name, weight.getComponent(vertex, slot)]] : []);
};
const records = [];
try {
  for (const id of options.bodies.split(",")) for (const rank of options.ranks.split(","))
    for (const quality of options.quality.split(",")) {
      const nation = id.split("-")[0] as WorkerNation, minimal = quality === "minimal";
      const worker = await assets.soldier(nation, id, rank as ArmourRank, minimal);
      worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0); worker.root.updateMatrixWorld(true);
      const surfaces: { mesh: SkinnedMesh; rest: Vector3[] }[] = [];
      worker.root.traverse(node => {
        if ((node as SkinnedMesh).isSkinnedMesh && /^armour_(?:underclothes|torso)_lod[01]$/.test(node.name) && visible(node)) {
          const mesh = node as SkinnedMesh;
          surfaces.push({ mesh, rest: pointsOf(mesh) });
        }
      });
      const pose = native.createWorkerPoser(worker), phases = [];
      for (const troop of ["shield", "heavy", "archer"]) for (const progress of ["rest", null, .48, .75]) {
        if (progress === "rest" && troop !== "shield") continue;
        const frame = { actorId: 1, nation, variant: id, x: 0, y: 0, z: 0, heading: 0,
          selected: false, visible: true, action: "idle_breathe", gaitPhase: .2,
          runBlend: 0, animationTime: .6, target: null, workerJob: "Soldier", carryingWare: null,
          workerTool: { shield: "sword", heavy: "axe", archer: "bow" }[troop], armourRank: rank,
          combat: { attackProgress: progress === "rest" ? null : progress, defending: false, doorMelee: false,
            faction: 0, type: troop, variant: 0 } } as WorkerFrame;
        if (progress !== "rest") for (let tick = 0; tick < 4; tick++) { clock += 1000; pose(frame); }
        worker.root.updateMatrixWorld(true);
        const posedLayers = surfaces.map(({ mesh }) => ({ mesh, points: pointsOf(mesh),
          indices: Array.from(mesh.geometry.index!.array) }));
        const linen = posedLayers.find(layer => layer.mesh.name.startsWith("armour_underclothes"));
        const outer = posedLayers.find(layer => layer.mesh.name.startsWith("armour_torso"));
        const overlap = linen && outer ? clothLayerOverlap(linen, outer, .68 * WORKER_SCALE) : undefined;
        for (const { mesh, rest } of surfaces) {
          const posed = pointsOf(mesh), index = mesh.geometry.index!;
          let maximumStretch = 0, maximumEdgeGrowth = 0;
          let witness: unknown;
          for (let at = 0; at < index.count; at += 3) for (let edge = 0; edge < 3; edge++) {
            const a = index.getX(at + edge), b = index.getX(at + (edge + 1) % 3);
            const before = rest[a]!.distanceTo(rest[b]!), after = posed[a]!.distanceTo(posed[b]!);
            if (before < .001 * WORKER_SCALE || Math.min(rest[a]!.y, rest[b]!.y) < .68 * WORKER_SCALE) continue;
            const stretch = after / before;
            if (stretch > maximumStretch) witness = { vertices: [a, b], rest: [rest[a]!.toArray(), rest[b]!.toArray()],
              posed: [posed[a]!.toArray(), posed[b]!.toArray()], before, after,
              weights: [weightsOf(mesh, a), weightsOf(mesh, b)] };
            maximumStretch = Math.max(maximumStretch, stretch);
            maximumEdgeGrowth = Math.max(maximumEdgeGrowth, after - before);
          }
          phases.push({ troop, progress, mesh: mesh.name, maximumStretch, maximumEdgeGrowth, overlap, witness });
        }
      }
      records.push({ id, rank, quality, phases });
      console.log(JSON.stringify({ id, rank, quality, maximumStretch: Math.max(...phases.map(phase => phase.maximumStretch)),
        maximumEdgeGrowth: Math.max(...phases.map(phase => phase.maximumEdgeGrowth)),
        maximumCrossings: Math.max(...phases.map(phase => phase.overlap?.crossings ?? 0)) }));
      worker.dispose();
    }
  const output = resolve(options.out ??
    `../resources/project-reviews/armour-shared-repair-2026-11-02/${options.folder}-strain-cpu.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ options, scope: "Actual loaded native poses, cloth edge strain above upper chest; no props/GPU/mutation",
    sourceHashes: Object.fromEntries(assets.assets), records }, null, 2));
} finally {
  assets.restore(); native.restore();
  Object.defineProperty(performance, "now", { configurable: true, value: originalNow });
}

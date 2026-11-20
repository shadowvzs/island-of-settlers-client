import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Box3, Group, type SkinnedMesh, Triangle, Vector3 } from "three";

import { TRIPO_ROSTER } from "../../../island-of-settlers-worker-generation/src/tripo-roster";
import { getAuthoredBuildingPlot } from "../../src/render-common/buildings/building-plot-profile";
import { CATAPULT_ENGINE_ORIGIN, CATAPULT_TRAVERSE } from "../../src/render-common/buildings/catapult-mechanism";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createWorkerCatapultSupport } from "../../src/renderers/three/worker-catapult-support";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const native = await loadCatapultCpuPoser(), assets = await createHatchAuditAssets();
const rear = process.env.SUPPORT_REAR === "1";
const label = process.env.SUPPORT_LABEL ?? (rear ? "rear-candidate" : "current");
const output = resolve(`../resources/project-reviews/catapult-hatch-cpu-2026-11-02/operator-support-${label}`);
const scale = getAuthoredBuildingPlot(16)!.structureScale, edge = .825 * scale;
const originX = CATAPULT_ENGINE_ORIGIN[0] * scale, originZ = CATAPULT_ENGINE_ORIGIN[2] * scale;
const bodyX = rear ? Number(process.env.SUPPORT_BODY_X ?? 0) * scale : (CATAPULT_TRAVERSE.body[0] - CATAPULT_ENGINE_ORIGIN[0]) * scale;
const bodyZ = rear ? Number(process.env.SUPPORT_BODY_Z ?? -.5) * scale : (CATAPULT_TRAVERSE.body[2] - CATAPULT_ENGINE_ORIGIN[2]) * scale;
const facing = rear ? Math.atan2(bodyZ, -bodyX) : CATAPULT_TRAVERSE.facing;
const sine = Math.sin(facing), cosine = Math.cos(facing);
const reports = [], point = new Vector3();
const skids = [-1, 1].map(side => new Box3(new Vector3((side * .4056 - .0624) * scale, .0201 * scale, -.4368 * scale),
  new Vector3((side * .4056 + .0624) * scale, .1215 * scale, .4368 * scale)));
try {
  for (const nation of Object.keys(TRIPO_ROSTER) as WorkerNation[]) for (const variant of [...TRIPO_ROSTER[nation].male, ...TRIPO_ROSTER[nation].female])
    for (const minimal of [false, true]) {
      const worker = await assets.soldier(nation, variant, "centurion", minimal);
      const group = new Group(); group.add(worker.root); group.position.y = .005; worker.root.scale.setScalar(WORKER_SCALE);
      const pose = native.createWorkerPoser(worker), phases = [], support = createWorkerCatapultSupport(worker.root);
      const idle = { action: "idle_breathe", animationTime: 0, catapultStoneDiameter: .11 * scale, y: 0 } as WorkerFrame;
      pose(idle); support.capture(idle);
      for (const gaitPhase of [0, .125, .25, .375, .5, .625, .75, .875]) {
        pose({ action: "walk", gaitPhase, runBlend: 0, animationTime: 0, carryingWare: null } as WorkerFrame);
        group.updateMatrixWorld(true);
        let radius = 0, witness: unknown, points = 0;
        let safeRearRadiusFor10mm = Infinity;
        let skidTriangles = 0;
        const candidates: { radius: number; height: number; mesh: string; point: number[] }[] = [];
        worker.root.traverseVisible(node => {
          const mesh = node as SkinnedMesh; if (!mesh.isSkinnedMesh) return;
          const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
          const positions = mesh.geometry.getAttribute("position");
          const selected = new Map<number, Vector3>();
          const used = mesh.geometry.index ? new Set(mesh.geometry.index.array) : new Set(Array.from({ length: positions.count }, (_, index) => index));
          for (const vertex of used) {
            let foot = 0;
            for (let slot = 0; slot < 4; slot++)
              if (/(Left|Right)(Foot|Toe)/.test(mesh.skeleton.bones[indices.getComponent(vertex, slot)]?.name ?? ""))
                foot += weights.getComponent(vertex, slot);
            if (foot < .6 || positions.getY(vertex) > .12) continue;
            mesh.getVertexPosition(vertex, point); point.applyMatrix4(mesh.matrixWorld); points++;
            const x = bodyX + point.x * cosine + point.z * sine;
            const z = bodyZ + point.z * cosine - point.x * sine;
            selected.set(vertex, new Vector3(x, point.y, z));
            const distance = Math.hypot(x, z);
            const allowed = edge - Math.abs(originX) - .01;
            safeRearRadiusFor10mm = Math.min(safeRearRadiusFor10mm,
              point.x + Math.sqrt(Math.max(0, allowed * allowed - point.z * point.z)));
            candidates.push({ radius: distance, height: point.y, mesh: mesh.name, point: point.toArray() });
            if (distance > radius) { radius = distance; witness = { mesh: mesh.name, point: point.toArray(), yaw: Math.atan2(z, x), x, z }; }
          }
          const order = mesh.geometry.index?.array ?? Array.from({ length: positions.count }, (_, index) => index);
          for (let at = 0; at < order.length; at += 3) {
            const a = selected.get(order[at]!), b = selected.get(order[at + 1]!), c = selected.get(order[at + 2]!);
            if (a && b && c && skids.some(box => box.intersectsTriangle(new Triangle(a, b, c)))) skidTriangles++;
          }
        });
        const minimumY = Math.min(...candidates.map(candidate => candidate.height));
        const contact = candidates.filter(candidate => candidate.height <= minimumY + .015)
          .reduce((best, candidate) => candidate.radius > best.radius ? candidate : best);
        phases.push({ gaitPhase, radius, points, minimumY, contact, safeRearRadiusFor10mm, skidTriangles,
          contactClearanceX: edge - Math.abs(originX) - contact.radius,
          clearanceX: edge - Math.abs(originX) - radius,
          clearanceZ: edge - Math.abs(originZ) - radius, witness });
      }
      reports.push({ nation, variant, detail: minimal ? "minimal" : "high", phases }); worker.dispose();
    }
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/review.json`, JSON.stringify({ scale, edge, originX, originZ, bodyX, bodyZ, rear, facing,
    sourceHashes: Object.fromEntries(assets.assets), reports }, null, 2));
  console.log(JSON.stringify(reports.map(report => ({ id: report.variant, detail: report.detail,
    clearance: Math.min(...report.phases.map(phase => phase.clearanceX)) })).sort((a, b) => a.clearance - b.clearance).slice(0, 8)));
} finally { assets.restore(); native.restore(); }

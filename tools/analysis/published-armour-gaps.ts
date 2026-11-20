import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Group, type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { playerAvatarBody } from "../../src/render-common/workers/player-avatar";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { snapshotHatchGeometry } from "./catapult-hatch-sections";

const native = await loadCatapultCpuPoser(), assets = await createHatchAuditAssets();
const output = resolve("../resources/project-reviews/published-armour-gaps-2026-11-02");
const nations = ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"] as const;
const nowOriginal = performance.now.bind(performance);
let poseClock = nowOriginal();
Object.defineProperty(performance, "now", { configurable: true, value: () => poseClock });
const reports = [];

interface Sample { region: string; first: number; outer: number; interlayer: number; point: number[]; normal: number[]; layers: number[] }
const percentile = (values: number[], share: number) => values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * share))] ?? null;

/** Source-skin rays against the actual published visible armour, with no canonical fitting proxy. */
const measure = (root: Group) => {
  const surface = snapshotHatchGeometry(root), armour = surface.filter(part => !/^body(?:_|$)/.test(part.label)
    && !part.label.startsWith("armour_head"));
  const positions: Vector3[] = [], indices: number[] = [];
  for (const part of armour) {
    const start = positions.length;
    for (let at = 0; at < part.vertices.length; at += 3) positions.push(new Vector3().fromArray(part.vertices, at));
    indices.push(...part.indices.map(vertex => vertex + start));
  }
  const grid = new TriangleGrid(positions, indices, .025), samples: Sample[] = [];
  const point = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
  const shoulder = ["Left", "Right"].map(side => root.getObjectByName(`${side}Arm`)!.getWorldPosition(new Vector3()));
  const neck = root.getObjectByName("Neck")!.getWorldPosition(new Vector3());
  const spine = root.getObjectByName("Spine2")!.getWorldPosition(new Vector3());
  root.traverseVisible(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh || !/^body(?:_|$)/.test(mesh.name)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some(material => material.name === "worker_body")) return;
    const order = mesh.geometry.index?.array; if (!order) return;
    const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    const share = (vertex: number, pattern: RegExp) => {
      let result = 0;
      for (let slot = 0; slot < 4; slot++)
        if (pattern.test(mesh.skeleton.bones[joints.getComponent(vertex, slot)]?.name ?? "")) result += weights.getComponent(vertex, slot);
      return result;
    };
    for (let at = 0; at < order.length; at += 3) {
      const vertices = [order[at]!, order[at + 1]!, order[at + 2]!];
      if (vertices.some(vertex => share(vertex, /^(Head|Neck)/) > .2)) continue;
      for (const [index, target] of [a, b, c].entries()) {
        mesh.getVertexPosition(vertices[index]!, target); target.applyMatrix4(mesh.matrixWorld);
      }
      point.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const armShare = vertices.reduce((sum, vertex) => sum + share(vertex, /^(Left|Right)(Shoulder|Arm)/), 0) / 3;
      const side = point.x >= 0 ? 0 : 1, distance = point.distanceTo(shoulder[side]!);
      let region = "";
      if (armShare > .2 && distance < .14) region = "shoulder";
      else if (point.y > spine.y - .07 && point.y < neck.y && Math.abs(point.x) < Math.abs(shoulder[0]!.x) * .8) region = "chest";
      if (!region) continue;
      normal.copy(b).sub(a).cross(c.clone().sub(a)); if (normal.lengthSq() < 1e-12) continue;
      normal.normalize();
      const radial = region === "shoulder" ? point.clone().sub(shoulder[side]!) : point.clone().sub(new Vector3(0, point.y, spine.z));
      if (normal.dot(radial) < 0) normal.negate();
      const layers: number[] = [];
      for (let previous = .0001; layers.length < 10;) {
        const hit = grid.raycast(point, normal, previous, .14);
        if (!hit) break;
        layers.push(hit.distance); previous = hit.distance + .0005;
      }
      if (!layers.length) continue; // Intentionally exposed skin is not a failed armour fit.
      const gaps = layers.slice(1).map((value, index) => value - layers[index]!);
      samples.push({ region, first: layers[0]!, outer: layers.at(-1)!, interlayer: Math.max(0, ...gaps),
        point: point.toArray(), normal: normal.toArray(), layers });
    }
  });
  return ["chest", "shoulder"].map(region => {
    const own = samples.filter(sample => sample.region === region);
    return { region, sampledCoveredTriangles: own.length,
      firstGap: { median: percentile(own.map(sample => sample.first), .5), p95: percentile(own.map(sample => sample.first), .95),
        max: percentile(own.map(sample => sample.first), 1) },
      interlayerGap: { p95: percentile(own.map(sample => sample.interlayer), .95), max: percentile(own.map(sample => sample.interlayer), 1) },
      outliers: own.filter(sample => sample.first > .025 || sample.interlayer > .025).toSorted((a, b) =>
        Math.max(b.first, b.interlayer) - Math.max(a.first, a.interlayer)).slice(0, 12) };
  });
};

try {
  for (const nation of nations) for (const rank of ["recruit", "soldier", "centurion"] as const) for (const minimal of [false, true]) {
    const variant = playerAvatarBody(nation, "male").variant, worker = await assets.soldier(nation, variant, rank, minimal);
    const group = new Group(); group.add(worker.root); worker.root.scale.setScalar(WORKER_SCALE);
    const pose = native.createWorkerPoser(worker), frames = [];
    for (const role of ["shield", "heavy", "archer"] as const) for (const state of ["idle", "walk", "attack"] as const) {
      const frame = { nation, variant, action: state === "walk" ? "walk" : "idle_breathe", animationTime: .75,
        gaitPhase: .25, runBlend: 0, carryingWare: null, workerJob: "Soldier", armourRank: rank,
        workerTool: { shield: "sword", heavy: "axe", archer: "bow" }[role],
        combat: { type: role, faction: 0, attackProgress: state === "attack" ? .35 : null, defending: false } } as WorkerFrame;
      poseClock += 1000; pose(frame); poseClock += 1000; pose(frame);
      frames.push({ role, state, regions: measure(group) });
    }
    reports.push({ nation, variant, rank, detail: minimal ? "minimal" : "high", frames });
    console.log(`${nation}/${rank}/${minimal ? "minimal" : "high"}`); worker.dispose();
  }
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/cpu-review.json`, JSON.stringify({
    scope: "Actual native published rig/armour; covered source-skin triangle rays; chest and proximal shoulders; 3 roles x idle/walk/attack",
    limitations: ["A ray gap is a candidate for native visual review, not an automatic defect", "Missing hidden source torso anatomy cannot be measured against a canonical proxy",
      "Garment thickness, lining and intentional articulated armour stand-off remain legitimate", "No alpha-texture rejection on feather cards; conservative geometry"],
    sourceHashes: Object.fromEntries(assets.assets), reports }, null, 2));
} finally { assets.restore(); native.restore(); Object.defineProperty(performance, "now", { configurable: true, value: nowOriginal }); }

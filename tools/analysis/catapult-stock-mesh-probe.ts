import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Group, Mesh, MeshBasicMaterial, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { TRIPO_ROSTER } from "../../../island-of-settlers-worker-generation/src/tripo-roster";
import { CATAPULT_DECK_HEIGHT } from "../../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "../../src/render-common/buildings/catapult-hatch";
import { CATAPULT_STONE_DIAMETER } from "../../src/render-common/buildings/catapult-mechanism";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { getJobAction } from "../../src/render-common/workers/worker-job-actions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { createCatapultRockGeometry } from "../../src/renderers/three/buildings/catapult-rock-geometry";
import { createCradledWareHandContacts, placeCarriedStone } from "../../src/renderers/three/worker-stone-carry";
import { applyCarriedWareScale } from "../../src/renderers/three/worker-ware-transfer";
import { catapultStockAnchor } from "../../src/shared/settlement/catapult-cycle";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { type SectionGeometry,snapshotHatchGeometry } from "./catapult-hatch-sections";

const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const profile = JSON.parse(await readFile(`${folder}/civilian-current-profile-candidate.json`, "utf8"));
const scale: number = profile.scale, plan = profile.profiles.find((entry: { direction: string }) => entry.direction === "up");
const offset = (h: number) => {
  const at = plan.knots.findIndex((k: number[], i: number) => i > 0 && k[0]! >= h);
  const a = plan.knots[at - 1], b = plan.knots[at], t = (h - a[0]) / (b[0] - a[0]), smooth = t * t * (3 - 2 * t);
  return [a[1] + (b[1] - a[1]) * smooth, a[2] + (b[2] - a[2]) * smooth];
};
const probe = (geometry: SectionGeometry[], height: number, detailed: boolean) => {
  const [ox, oz] = offset(height), recipe = createCatapultRockGeometry(detailed), p = recipe.getAttribute("position");
  const order = recipe.index ? Array.from(recipe.index.array) : Array.from({ length: p.count }, (_, i) => i);
  const hits = [];
  for (let slot = 0; slot < 5; slot++) {
    const anchor = [...catapultStockAnchor(slot)] as [number, number, number];
    if (slot % 2) {
      anchor[2]! += Number(process.env.STOCK_NEAR_SHIFT ?? 0);
      anchor[0]! += Number(process.env.STOCK_NEAR_SHIFT_X ?? 0);
    }
    const yaw = slot * 1.83, c = Math.cos(yaw), s = Math.sin(yaw);
    const centre = new Vector3((anchor[0] - CATAPULT_HATCH_WELL.center[0]) * scale - ox,
      (anchor[1] - CATAPULT_DECK_HEIGHT) * scale + height, (anchor[2] - CATAPULT_HATCH_WELL.center[2]) * scale - oz);
    const vertices = Array.from({ length: p.count }, (_, i) => new Vector3(
      p.getX(i) * c + p.getZ(i) * s, p.getY(i), p.getZ(i) * c - p.getX(i) * s)
      .multiplyScalar(CATAPULT_STONE_DIAMETER * scale).add(centre));
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    vertices.forEach(v => { min.min(v); max.max(v); });
    const grid = new TriangleGrid(vertices, order), direction = new Vector3();
    for (const shape of geometry) for (let at = 0; at < shape.indices.length; at += 3) {
      const points = shape.indices.slice(at, at + 3).map(i => new Vector3().fromArray(shape.vertices, i * 3));
      if (["x", "y", "z"].some(axis => Math.max(...points.map(v => v[axis as "x"])) < min[axis as "x"]
        || Math.min(...points.map(v => v[axis as "x"])) > max[axis as "x"])) continue;
      let crossing = false;
      for (let edge = 0; edge < 3; edge++) {
        const a = points[edge]!, b = points[(edge + 1) % 3]!;
        direction.copy(b).sub(a); const distance = direction.length();
        if (distance > 1e-8 && grid.raycast(a, direction.normalize(), 1e-6, distance - 1e-6)) crossing = true;
        direction.copy(a).sub(centre); const radius = direction.length();
        const hit = grid.raycast(centre, direction.normalize(), 0, .5);
        if (hit && hit.distance > radius + .0001) crossing = true;
      }
      if (crossing) { hits.push({ slot, label: shape.label, triangle: at / 3, points: points.map(p => p.toArray()) }); break; }
    }
  }
  recipe.dispose(); return hits;
};
const native = await loadCatapultCpuPoser(), assets = await createHatchAuditAssets(), records = [];
const originalNow = performance.now.bind(performance); let time = originalNow();
Object.defineProperty(performance, "now", { configurable: true, value: () => time });
try {
  for (const variant of (process.env.STOCK_BODIES ?? "roman-man-grey,maya-female-3").split(",")) {
    const nation = Object.entries(TRIPO_ROSTER).find(([, roster]) =>
      [...roster.male, ...roster.female].some(id => id === variant))![0] as WorkerFrame["nation"];
    const worker = await assets.civilian(nation, variant, false), group = new Group();
    group.position.y = .005; group.add(worker.root); worker.root.scale.setScalar(WORKER_SCALE);
    const geometry = createCatapultRockGeometry(true); geometry.scale(...Array(3)
      .fill(CATAPULT_STONE_DIAMETER * scale / WORKER_SCALE) as [number, number, number]);
    const stone = new Group(), shape = new Group(); shape.name = "ware_geometry";
    shape.add(new Mesh(geometry, new MeshBasicMaterial())); stone.add(shape); worker.root.add(stone);
    applyCarriedWareScale(stone, worker.root, undefined, true);
    const pose = native.createWorkerPoser(worker), contacts = createCradledWareHandContacts(worker.root);
    for (const phase of [0, .25, .5, .75]) {
      const frame = { actorId: 0, nation, variant, visible: true, action: getJobAction("Carrier", "idle", "stone"),
        workerJob: "Carrier", carryingWare: "stone", standingCarry: true, catapultTuckedCarry: true,
        catapultStoneDiameter: CATAPULT_STONE_DIAMETER * scale, gaitPhase: phase, animationTime: phase * 3,
        runBlend: 0, heading: plan.heading, x: 0, y: 0, z: 0, selected: false, target: null } as WorkerFrame;
      worker.root.rotation.set(0, frame.heading, 0); time += 1000; pose(frame); time += 1000; pose(frame);
      placeCarriedStone(stone, true); stone.userData.catapultTucked = true;
      contacts(stone, { direction: "pickup", ware: "stone", progress: 1, target: frame }, true);
      const snapshot = snapshotHatchGeometry(group);
      for (let height = 0; height <= 1.25; height += .025) {
        const hits = probe(snapshot, height, true);
        if (hits.length) records.push({ variant, phase, height, hits });
      }
    }
    worker.dispose(); geometry.dispose();
  }
  await writeFile(`${folder}/civilian-actual-stock-probe.json`, JSON.stringify({ records }, null, 2));
  console.log(JSON.stringify({ collisions: records.length, first: records[0] }));
} finally { assets.restore(); native.restore(); Object.defineProperty(performance, "now", { configurable: true, value: originalNow }); }

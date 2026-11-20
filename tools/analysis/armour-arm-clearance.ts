import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame, WorkerNation } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { folder: { type: "string" }, bodies: { type: "string" }, out: { type: "string" } } });
if (!values.folder || !values.bodies) throw new Error("Choose an explicit draft folder and donor identities");
const native = await loadCatapultCpuPoser(), assets = await createHatchAuditAssets({ armourFolder: values.folder });
const previousNow = performance.now.bind(performance);
let clock = previousNow();
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
const pointsOf = (mesh: SkinnedMesh) => Array.from({ length: mesh.geometry.getAttribute("position").count },
  (_, vertex) => mesh.applyBoneTransform(vertex,
    new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld));
const records = [];
try {
  for (const id of values.bodies.split(",")) for (const minimal of [false, true]) {
    const nation = id.split("-")[0] as WorkerNation, worker = await assets.soldier(nation, id, "recruit", minimal);
    worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0); worker.root.updateMatrixWorld(true);
    const bodies: SkinnedMesh[] = [], cloth: SkinnedMesh[] = [];
    worker.root.traverse(node => {
      const mesh = node as SkinnedMesh;
      if (!mesh.isSkinnedMesh || !node.visible) return;
      if (/^body(?:_|$)/.test(node.name)) bodies.push(mesh);
      if (new RegExp(`^armour_(?:torso|underclothes)_lod${minimal ? 1 : 0}$`).test(node.name)) cloth.push(mesh);
    });
    const bone = (name: string) => bodies[0]!.skeleton.bones.find(bone => bone.name === name)!.getWorldPosition(new Vector3());
    const samples = bodies.flatMap(mesh => {
      const points = pointsOf(mesh), joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
      return points.flatMap((point, vertex) => {
        const side = point.x > 0 ? "Left" : "Right", start = bone(`${side}Arm`);
        const axis = bone(`${side}ForeArm`).sub(start), fraction = point.clone().sub(start).dot(axis) / axis.lengthSq();
        if (fraction < .02 || fraction > .40) return [];
        const centre = start.clone().addScaledVector(axis, fraction);
        if (point.distanceTo(centre) > .14 * WORKER_SCALE) return [];
        let share = 0;
        for (let slot = 0; slot < 4; slot++) if (new RegExp(`^${side}(?:Shoulder|Arm|ForeArm)$`)
          .test(mesh.skeleton.bones[joints.getComponent(vertex, slot)]!.name)) share += weights.getComponent(vertex, slot);
        return share > .75 ? [{ mesh, vertex, side, fraction }] : [];
      });
    });
    if (!samples.length || !cloth.length) throw new Error(`${id}: real skin and garment witnesses are required`);
    const pose = native.createWorkerPoser(worker), phases = [];
    for (const troop of ["shield", "heavy", "archer"]) for (const progress of [null, .48, .75]) {
      const frame = { actorId: 1, nation, variant: id, x: 0, y: 0, z: 0, heading: 0,
        action: "idle_breathe", gaitPhase: .2, runBlend: 0, animationTime: .6, carryingWare: null,
        workerJob: "Soldier", armourRank: "recruit", combat: { type: troop, attackProgress: progress,
          defending: false, doorMelee: false, faction: 0, variant: 0 } } as WorkerFrame;
      for (let tick = 0; tick < 4; tick++) { clock += 1000; pose(frame); }
      worker.root.updateMatrixWorld(true);
      const points: Vector3[] = [], indices: number[] = [];
      for (const mesh of cloth) {
        const offset = points.length; points.push(...pointsOf(mesh));
        indices.push(...Array.from(mesh.geometry.index!.array, vertex => vertex + offset));
      }
      const grid = new TriangleGrid(points, indices), bodyPoints = new Map(bodies.map(mesh => [mesh, pointsOf(mesh)]));
      const skinPoints: Vector3[] = [], skinIndices: number[] = [];
      for (const mesh of bodies) {
        const offset = skinPoints.length; skinPoints.push(...bodyPoints.get(mesh)!);
        skinIndices.push(...Array.from(mesh.geometry.index!.array, vertex => vertex + offset));
      }
      const skinGrid = new TriangleGrid(skinPoints, skinIndices);
      const results = samples.map(({ fraction, mesh, side, vertex }) => {
        const start = bone(`${side}Arm`), centre = start.clone().lerp(bone(`${side}ForeArm`), fraction);
        const skin = bodyPoints.get(mesh)![vertex]!, direction = skin.clone().sub(centre), radius = direction.length();
        direction.normalize();
        const reach = .25 * WORKER_SCALE, outside = centre.clone().addScaledVector(direction, reach);
        const inward = direction.clone().negate();
        const hit = grid.raycast(outside, inward, 0, reach);
        const skinHit = skinGrid.raycast(outside, inward, 0, reach);
        const hidden = Boolean(skinHit && reach - skinHit.distance > radius + .0005);
        return { vertex, side, fraction, skin: skin.toArray(), hidden,
          clearance: hit ? reach - hit.distance - radius : null };
      });
      const exposed = results.filter(point => !point.hidden);
      phases.push({ troop, progress, samples: results.length, exposed: exposed.length,
        missed: exposed.filter(point => point.clearance === null).length,
        minimum: Math.min(...exposed.flatMap(point => point.clearance === null ? [] : [point.clearance])),
        witnesses: exposed.filter(point => point.clearance === null || point.clearance < -.0005)
          .sort((a, b) => (a.clearance ?? -1) - (b.clearance ?? -1)).slice(0, 10) });
    }
    records.push({ id, quality: minimal ? "minimal" : "high", phases });
    console.log(JSON.stringify({ id, minimal, samples: samples.length,
      minimum: Math.min(...phases.map(phase => phase.minimum)), missed: Math.max(...phases.map(phase => phase.missed)) }));
    worker.dispose();
  }
  const output = resolve(values.out ?? `../resources/project-reviews/armour-shared-repair-2026-11-02/${values.folder}-arm-clearance.json`);
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify({ scope: "Native posed original arm points (.02..40% upper-arm length) versus outermost garment intersection from outside along current bone cross-section. Points occluded by another actual body surface are reported hidden and excluded. No props/GPU/mutation; sampled exposed-skin witnesses, not a complete solid-volume proof.", records }, null, 2));
} finally { assets.restore(); native.restore(); Object.defineProperty(performance, "now", { configurable: true, value: previousNow }); }

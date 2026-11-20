import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type Mesh, type Object3D, type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { findClothCuffs, poseClothCuffs, type PosedClothCuff, rayThroughClothCuff } from "./cloth-cuff-apertures";

interface Vertex { mesh: SkinnedMesh; vertex: number }
const sleeveFrom = Number(process.env.SLEEVE_FROM ?? .20), sleeveTo = Number(process.env.SLEEVE_TO ?? .45);
const coveredFrom = Number(process.env.COVERED_FROM ?? .30), coveredTo = Number(process.env.COVERED_TO ?? .50);
const supportShare = Number(process.env.ARM_SUPPORT_SHARE ?? .65), includeShoulder = process.env.ROOT_SUPPORT === "1";
const spatialShoulder = process.env.SPATIAL_SHOULDER === "1";
const supportLayer = process.env.SUPPORT_LAYER ?? "body", sleeveLayer = process.env.SLEEVE_LAYER ?? "both";
const owns = (node: Object3D, expression: RegExp) => {
  for (let parent: Object3D | null = node; parent; parent = parent.parent)
    if (expression.test(parent.name)) return true;
  return false;
};
const pointOf = ({ mesh, vertex }: Vertex) => mesh.applyBoneTransform(vertex,
  new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld);
const weightsOf = ({ mesh, vertex }: Vertex) => {
  const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
  const result = new Map<string, number>();
  for (let slot = 0; slot < 4; slot++) {
    const joint = joints.getComponent(vertex, slot), weight = weights.getComponent(vertex, slot);
    if (weight) result.set(mesh.skeleton.bones[joint]!.name, weight);
  }
  return result;
};
const armShare = (vertex: Vertex, side: string) => [...weightsOf(vertex)]
  .reduce((sum, [name, share]) => sum
    + (name === `${side}Arm` || includeShoulder && name === `${side}Shoulder` ? share : 0), 0);
const meshVertices = (mesh: SkinnedMesh) => Array.from({ length: mesh.geometry.getAttribute("position").count },
  (_, vertex) => ({ mesh, vertex }));
const sourceArm = (root: Object3D, side: string) => {
  const vertices: Vertex[] = [], indices: number[] = [];
  root.traverse(node => {
    const owner = supportLayer === "linen" ? /^armour_underclothes_lod0$/ : /^body(?:_|$)/;
    if (!(node as Mesh).isMesh || !(node as SkinnedMesh).isSkinnedMesh || !owns(node, owner)) return;
    const mesh = node as SkinnedMesh, offset = vertices.length, own = meshVertices(mesh);
    vertices.push(...own);
    const index = mesh.geometry.index;
    if (!index) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = mesh.geometry.groups.length ? mesh.geometry.groups
      : [{ start: 0, count: index.count, materialIndex: 0 }];
    for (const group of groups) {
      if (supportLayer === "body" && /linen|woven|cloth/.test(materials[group.materialIndex ?? 0]?.name ?? "")) continue;
      for (let at = group.start; at < group.start + group.count; at += 3) {
        const face = [0, 1, 2].map(corner => index.getX(at + corner));
        if (supportLayer === "linen" || face.every(vertex => armShare(own[vertex]!, side) > supportShare))
          indices.push(...face.map(vertex => vertex + offset));
      }
    }
  });
  assert(indices.length, `${side}: actual drawn source arm support`);
  return { vertices, indices, restPoints: vertices.map(pointOf) };
};
const sleeveVertices = (root: Object3D, side: string) => {
  const start = root.getObjectByName(`${side}Arm`)!.getWorldPosition(new Vector3());
  const end = root.getObjectByName(`${side}ForeArm`)!.getWorldPosition(new Vector3());
  const axis = end.clone().sub(start), vertices: Vertex[] = [];
  root.traverse(node => {
    const owner = sleeveLayer === "torso" ? /^armour_torso_lod0$/ : /^armour_(?:torso|underclothes)_lod0$/;
    if (!(node as SkinnedMesh).isSkinnedMesh || !owns(node, owner)) return;
    for (const vertex of meshVertices(node as SkinnedMesh)) {
      const point = pointOf(vertex), fraction = point.clone().sub(start).dot(axis) / axis.lengthSq();
      const centre = start.clone().addScaledVector(axis, fraction);
      if (fraction > sleeveFrom && fraction < sleeveTo && point.distanceTo(centre) < .10 * WORKER_SCALE) vertices.push(vertex);
    }
  });
  assert(vertices.length, `${side}: generated sleeve vertices`);
  return vertices;
};
const posedSurface = (root: Object3D, expression: RegExp) => {
  const points: Vector3[] = [], indices: number[] = [];
  root.traverse(node => {
    if (!(node as SkinnedMesh).isSkinnedMesh || !owns(node, expression)) return;
    const mesh = node as SkinnedMesh, offset = points.length;
    points.push(...meshVertices(mesh).map(pointOf));
    const index = mesh.geometry.index;
    if (index) for (let at = 0; at < index.count; at++) indices.push(offset + index.getX(at));
  });
  return new TriangleGrid(points, indices);
};
const coveredArmFaces = (root: Object3D, side: string, arm: ReturnType<typeof sourceArm>) => {
  if (supportLayer !== "body") return [];
  const start = root.getObjectByName(`${side}Arm`)!.getWorldPosition(new Vector3());
  const axis = root.getObjectByName(`${side}ForeArm`)!.getWorldPosition(new Vector3()).sub(start);
  const fractions = arm.vertices.map(vertex => pointOf(vertex).sub(start).dot(axis) / axis.lengthSq());
  const neck = root.getObjectByName("Neck")!.getWorldPosition(new Vector3());
  const chest = root.getObjectByName("Spine2")!.getWorldPosition(new Vector3());
  const triangles: number[][] = [];
  for (let at = 0; at < arm.indices.length; at += 3) {
    const face = arm.indices.slice(at, at + 3);
    if (spatialShoulder && !face.every(vertex => {
      const point = arm.restPoints[vertex]!;
      return point.x * Math.sign(start.x) > Math.abs(start.x) * .45
        && point.y >= chest.y - .03 * WORKER_SCALE && point.y <= neck.y + .005 * WORKER_SCALE;
    })) continue;
    if (face.every(vertex => fractions[vertex]! >= coveredFrom && fractions[vertex]! <= coveredTo)) triangles.push(face);
  }
  return triangles;
};
const measureCoverage = (arm: ReturnType<typeof sourceArm>, triangles: number[][],
  body: TriangleGrid, cloth: TriangleGrid, cuffs: PosedClothCuff[]) => {
  const points = arm.vertices.map(pointOf), views = [];
  for (const angle of [.18, Math.PI + .25]) {
    const camera = new Vector3(Math.sin(angle) * .95, .88, Math.cos(angle) * .95);
    let checked = 0, missing = 0, visibleThroughOpenCuff = 0;
    const witnesses: { mesh: string; point: number[]; restPoint: number[]; uvs: number[][];
      vertices: number[]; weights: [string, number][][] }[] = [];
    for (const face of triangles) {
      const corners = face.map(vertex => points[vertex]!);
      const centre = corners.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(3);
      const direction = camera.clone().sub(centre).normalize();
      const toCamera = camera.distanceTo(centre);
      const normal = corners[1]!.clone().sub(corners[0]!).cross(corners[2]!.clone().sub(corners[0]!));
      const material = arm.vertices[face[0]!]!.mesh.material;
      const doubleSided = (Array.isArray(material) ? material[0] : material)!.side === 2;
      if (!doubleSided && normal.dot(direction) <= 0 || body.raycast(centre, direction, .0005, toCamera)) continue;
      checked++;
      if (cloth.raycast(centre, direction, .0003, toCamera, hit => hit.facing > 0)) continue;
      const cuff = rayThroughClothCuff(centre, direction, cuffs);
      if (cuff && cuff.distance < toCamera) { visibleThroughOpenCuff++; continue; }
      missing++;
      if (witnesses.length < 4) witnesses.push({ mesh: arm.vertices[face[0]!]!.mesh.name,
        point: centre.toArray(), restPoint: face.reduce((point, vertex) =>
          point.addScaledVector(arm.restPoints[vertex]!, 1 / 3), new Vector3()).toArray(),
        uvs: face.map(vertex => { const source = arm.vertices[vertex]!, uv = source.mesh.geometry.getAttribute("uv");
          return [uv.getX(source.vertex), uv.getY(source.vertex)]; }),
        vertices: face.map(vertex => arm.vertices[vertex]!.vertex),
        weights: face.map(vertex => [...weightsOf(arm.vertices[vertex]!)]) });
    }
    views.push({ angle, checked, missing, visibleThroughOpenCuff, witnesses });
  }
  return views;
};
const native = await loadCatapultCpuPoser();
const assets = await createHatchAuditAssets({ armourFolder: process.env.ARMOUR_FOLDER ?? "armour-repair-pilots" });
const originalNow = performance.now.bind(performance);
let clock = originalNow();
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
const records = [];
try {
  for (const id of (process.env.BODIES ?? "viking-man-blond").split(",")) {
    const nation = id.startsWith("viking") ? "viking" : "roman";
    const worker = await assets.soldier(nation, id, "soldier", false);
    worker.root.scale.setScalar(WORKER_SCALE); worker.root.updateMatrixWorld(true);
    const samples = ["Left", "Right"].map(side => {
      const arm = sourceArm(worker.root, side);
      return { side, arm, covered: coveredArmFaces(worker.root, side, arm), sleeve: sleeveVertices(worker.root, side) };
    });
    const pose = native.createWorkerPoser(worker), phases = [];
    const cuffDefinitions: ReturnType<typeof findClothCuffs> = [];
    worker.root.traverse(node => {
      if ((node as SkinnedMesh).isSkinnedMesh && owns(node, /^armour_underclothes_lod0$/))
        cuffDefinitions.push(...findClothCuffs(node as SkinnedMesh));
    });
    for (const [label, progress] of [["rest", null], ["idle", null], ["windup", .48], ["impact", .75]] as const) {
      const frame = { action: "idle_breathe", actorId: 1, animationTime: .6, armourRank: "soldier",
        carryingWare: null, combat: { attackProgress: progress, defending: false, doorMelee: false,
          faction: 0, type: "archer", variant: 0 }, gaitPhase: .2, heading: 0, nation, runBlend: 0,
        selected: false, target: null, variant: id, visible: true, workerJob: "Soldier",
        workerTool: "bow", x: 0, y: 0, z: 0 } as WorkerFrame;
      if (label !== "rest") for (let tick = 0; tick < 3; tick++) { clock += 1000; pose(frame); }
      worker.root.updateMatrixWorld(true);
      const body = posedSurface(worker.root, /^body(?:_|$)/);
      const cloth = posedSurface(worker.root, /^armour_(?:torso|underclothes)_lod0$/);
      const cuffs = poseClothCuffs(cuffDefinitions);
      for (const { arm, covered, side, sleeve } of samples) {
        const surface = new TriangleGrid(arm.vertices.map(pointOf), arm.indices);
        let maximumDistance = 0, maximumMismatch = 0, witness: unknown;
        for (const vertex of sleeve) {
          const point = pointOf(vertex), contact = surface.closestPoint(point, .2);
          if (!contact) throw new Error(`${side}: sleeve farther than20cm from actual arm`);
          const expected = new Map<string, number>();
          for (let corner = 0; corner < 3; corner++)
            for (const [name, share] of weightsOf(arm.vertices[arm.indices[contact.triangle * 3 + corner]!]!))
              expected.set(name, (expected.get(name) ?? 0) + share * contact.bary[corner]!);
          const actual = weightsOf(vertex), mismatch = [...new Set([...expected.keys(), ...actual.keys()])]
            .reduce((sum, name) => sum + Math.abs((actual.get(name) ?? 0) - (expected.get(name) ?? 0)), 0);
          if (contact.distance > maximumDistance) witness = { mesh: vertex.mesh.name, vertex: vertex.vertex,
            point: point.toArray(), support: contact.point.toArray(), actual: [...actual], expected: [...expected] };
          maximumDistance = Math.max(maximumDistance, contact.distance);
          maximumMismatch = Math.max(maximumMismatch, mismatch);
        }
        phases.push({ label, side, vertices: sleeve.length, maximumDistance, maximumMismatch, witness,
          coverage: measureCoverage(arm, covered, body, cloth, cuffs) });
      }
    }
    const bodyMaterials: { name: string; side: number; modelDeterminant: number }[] = [];
    worker.root.traverse(node => {
      if (!(node as Mesh).isMesh || !owns(node, /^body(?:_|$)/)) return;
      const mesh = node as Mesh, materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      bodyMaterials.push(...materials.map(material => ({ name: material.name, side: material.side,
        modelDeterminant: mesh.matrixWorld.determinant() })));
    });
    records.push({ id, phases, bodyMaterials });
    console.log(JSON.stringify({ id, maximumDistance: Math.max(...phases.map(phase => phase.maximumDistance)),
      coverageChecked: phases.flatMap(phase => phase.coverage).reduce((sum, view) => sum + view.checked, 0),
      coverageMissing: phases.flatMap(phase => phase.coverage).reduce((sum, view) => sum + view.missing, 0) }));
    worker.dispose();
  }
  const output = resolve(process.env.SLEEVE_OUTPUT ??
    "../resources/project-reviews/armour-shared-repair-2026-11-02/sewn-mail-m/sleeve-motion-cpu.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ coveredFrom, coveredTo, includeShoulder, sleeveFrom, sleeveLayer,
    sleeveTo, spatialShoulder, supportLayer, supportShare,
    sourceHashes: Object.fromEntries(assets.assets), records }, null, 2));
} finally {
  assets.restore(); native.restore();
  Object.defineProperty(performance, "now", { configurable: true, value: originalNow });
}

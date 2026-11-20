import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type SkinnedMesh, Vector3 } from "three";

import { fitClothMotion, type MotionClothPose } from "../../../island-of-settlers-worker-generation/src/armour/cloth-motion-fit";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { armourClothControlPositions, type ClothControlVertex } from "./armour-cloth-controls";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { folder: { type: "string" }, iterations: { type: "string", default: "30" },
  out: { type: "string" }, solution: { type: "string" } } });
if (!values.folder || !/^[a-z0-9-]+$/.test(values.folder) || !values.out)
  throw new Error("Choose a source-topology garment stage and an output receipt");
const folder = values.folder, id = "nubian-man-scarf", ready = resolve("../island-of-settlers-worker-generation/game_ready");
const provenance = JSON.parse(await readFile(resolve(ready, folder, id, "provenance.json"), "utf8"));
const frames = await createEquippedCpuFrames({ folder: "armour", bodies: [id], ranks: ["recruit"],
  qualities: ["high"], sourceFolder: folder });
if (frames.records.length !== 1 || frames.records[0]!.modelSha256 !== provenance.outputSha256)
  throw new Error("Source garment changed after its preservation receipt");
const assets = await createHatchAuditAssets();
try {
  const worker = await assets.pack.load("nubian", id, pathToFileURL(resolve(ready, folder, id, "model.glb")).href);
  worker.root.scale.setScalar(WORKER_SCALE); worker.root.updateMatrixWorld(true);
  const mesh = worker.root.getObjectByName("body") as SkinnedMesh;
  if (!mesh?.isSkinnedMesh) throw new Error("Original skinned garment is missing");
  const geometry = mesh.geometry, position = geometry.getAttribute("position"), order = geometry.index!;
  const skin = geometry.getAttribute("skinWeight"), joints = geometry.getAttribute("skinIndex");
  const pointOf = (vertex: number) => mesh.applyBoneTransform(vertex,
    new Vector3().fromBufferAttribute(position, vertex)).applyMatrix4(mesh.matrixWorld);
  const rest = Array.from({ length: position.count }, (_, vertex) => pointOf(vertex));
  const changed = new Set<number>(provenance.changedVertices), vertices: ClothControlVertex[] = [];
  const remap = new Map<number, number>(), known = new Map<string, number>(), indices: number[] = [];
  for (const face of provenance.originalCostumeFaces as number[]) {
    const mapped = [];
    for (let corner = 0; corner < 3; corner++) {
      const vertex = order.getX(face * 3 + corner);
      if (!remap.has(vertex)) {
        const influences = new Map<string, number>();
        for (let slot = 0; slot < 4; slot++) if (skin.getComponent(vertex, slot) > 1e-8)
          influences.set(mesh.skeleton.bones[joints.getComponent(vertex, slot)]!.name, skin.getComponent(vertex, slot));
        const movable = changed.has(vertex);
        // Only verified original costume may acquire controls. Preserve the source above the waist.
        if (movable) {
          for (const name of ["Hips", "LeftUpLeg", "RightUpLeg"]) if (influences.size < 4 && !influences.has(name))
            influences.set(name, 0);
          const knee = rest[vertex]!.x > 0 ? "LeftLeg" : "RightLeg";
          if (influences.size < 4 && !influences.has(knee)) influences.set(knee, 0);
        }
        const bones = [...influences.keys()], weights = [...influences.values()];
        const key = `${rest[vertex]!.toArray().map(value => value.toFixed(7)).join(",")}/${movable}/${
          [...influences].sort(([a], [b]) => a.localeCompare(b)).map(([name, weight]) => `${name}:${weight.toFixed(7)}`).join(",")}`;
        let control = known.get(key);
        if (control === undefined) {
          control = vertices.length; known.set(key, control);
          vertices.push({ rest: rest[vertex]!, movable, bones, weights, aliases: [], localEase: new Vector3(),
            fixedSlots: bones.flatMap((name, slot) => /Neck|Head|ForeArm|Hand/.test(name) ? [slot] : []) });
        }
        vertices[control]!.aliases.push({ mesh, vertex }); remap.set(vertex, control);
      }
      mapped.push(remap.get(vertex)!);
    }
    indices.push(...mapped);
  }
  const restGrid = new TriangleGrid(vertices.map(vertex => vertex.rest), indices);
  const bones = (name: string) => new Vector3().setFromMatrixPosition(mesh.skeleton.bones.find(bone => bone.name === name)!.matrixWorld);
  const samples = (provenance.originalLegVertices as number[]).flatMap(vertex => {
    const side = rest[vertex]!.x > 0 ? "Left" : "Right", start = bones(`${side}UpLeg`), end = bones(`${side}Leg`);
    const axis = end.clone().sub(start), fraction = rest[vertex]!.clone().sub(start).dot(axis) / axis.lengthSq();
    if (rest[vertex]!.y > provenance.weightField.waist * WORKER_SCALE - .03
      || rest[vertex]!.y < provenance.weightField.hem * WORKER_SCALE + .025) return [];
    const centre = start.clone().addScaledVector(axis, fraction), outward = rest[vertex]!.clone().sub(centre).normalize();
    const hit = restGrid.raycast(rest[vertex]!, outward, .001, .3, hit => hit.facing > 0);
    return hit ? [{ vertex, side, fraction }] : [];
  });
  if (samples.length < 20) throw new Error("Original covered leg samples are too sparse");
  const poses: MotionClothPose[] = [], labels = [], knownPoses = new Set<string>();
  for (const cell of frames.records[0]!.cells) {
    const key = JSON.stringify(cell.diagnostics.skeletons, (_key, value) =>
      typeof value === "number" ? Number(value.toFixed(8)) : value);
    if (knownPoses.has(key)) continue;
    knownPoses.add(key); applyArmourPoseSnapshot(worker.root, cell.diagnostics);
    poses.push({ controls: armourClothControlPositions(vertices), samples: samples.map(({ fraction, side, vertex }) => ({
      centre: bones(`${side}UpLeg`).lerp(bones(`${side}Leg`), fraction), skin: pointOf(vertex) })) });
    labels.push({ troop: cell.troop, motion: cell.name });
  }
  const options = { clearance: .002 * WORKER_SCALE, iterations: Number(values.iterations), maximumStretch: 1.6,
    reach: .35 * WORKER_SCALE, strainAllowance: .003 * WORKER_SCALE, relaxation: .5 };
  const fit = fitClothMotion(vertices, indices, poses, options);
  const report = { scope: "Dry-run cloth-only skinning of proven original Nubian kilt topology, preserving all geometry and other anatomy. Actual production equipment/poses; no GLB or source publication. Failed constraints remain failures.",
    modelSha256: provenance.outputSha256, vertices: vertices.length, samples: samples.length, options,
    passed: fit.passed, iterations: fit.iterations, phases: labels.map((label, index) => ({ ...label,
      before: fit.before[index], after: fit.after[index] })) };
  await writeFile(values.out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: fit.passed, samples: samples.length, uniquePoses: poses.length,
    minimumClearance: Math.min(...fit.after.map(phase => phase.minimumClearance)),
    failedPoses: fit.after.filter(phase => phase.missed || phase.skinViolations || phase.edgeViolations).length }));
  if (values.solution) {
    if (!fit.passed) throw new Error("A failed source-clothes fit cannot emit a solution");
    await writeFile(values.solution, JSON.stringify({ schema: 1, modelSha256: provenance.outputSha256,
      originalSourceSha256: provenance.sourceSha256, vertices: vertices.filter(vertex => vertex.movable).map(vertex => ({
        aliases: vertex.aliases.map(alias => alias.vertex), bones: vertex.bones, weights: fit.weights[vertices.indexOf(vertex)] })) }, null, 2));
  }
  worker.dispose();
} finally { assets.restore(); }

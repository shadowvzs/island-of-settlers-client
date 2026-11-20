import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type SkinnedMesh, Vector3 } from "three";

import { fitClothMotion, type MotionClothPose } from "../../../island-of-settlers-worker-generation/src/armour/cloth-motion-fit";
import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { armourClothControlPositions, armourClothEaseControls, createArmourClothControls } from "./armour-cloth-controls";
import { seedArmourClothWeights } from "./armour-cloth-seed";
import { createEquippedCpuFrames } from "./armour-equipped-frame-source";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { armourPointOf, createArmourSourceSamples } from "./armour-source-samples";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { review: { type: "string" }, out: { type: "string" },
  "cpu-folder": { type: "string" }, ranks: { type: "string", default: "recruit" },
  bodies: { type: "string" }, ease: { type: "string", default: "0" },
  "target-folder": { type: "string" }, solution: { type: "string" },
  relaxation: { type: "string", default: "1" },
  "seed-folder": { type: "string" },
  quality: { type: "string", default: "high" }, iterations: { type: "string", default: "30" } } });
if (!values.out || Boolean(values.review) === Boolean(values["cpu-folder"]))
  throw new Error("Choose exactly one captured native review or explicit CPU-equipped source folder, plus output");
if (values["cpu-folder"] && !values.bodies) throw new Error("CPU-equipped fitting requires explicit identities");
const input = values.review ? JSON.parse(await readFile(values.review, "utf8"))
  : await createEquippedCpuFrames({ folder: values["cpu-folder"]!, bodies: values.bodies!.split(","),
    ranks: values.ranks.split(","), qualities: values.quality.split(",") });
const records = [], solutions = [];
for (const record of input.records) {
  if (values.bodies && !values.bodies.split(",").includes(record.body) || !values.quality.split(",").includes(record.quality)) continue;
  if (createHash("sha256").update(await readFile(record.modelPath)).digest("hex") !== record.modelSha256)
    throw new Error("Native model hash changed; captured controls no longer apply");
  const folder = record.modelPath.split("game_ready/")[1]!.split("/")[0]!;
  const assets = await createHatchAuditAssets({ armourFolder: values["target-folder"] ?? folder });
  try {
    const minimal = record.quality === "minimal", worker = await assets.soldier(record.nation, record.body, record.rank, minimal);
    worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0); worker.root.updateMatrixWorld(true);
    const maximumEase = Number(values.ease) / 1000;
    if (!Number.isFinite(maximumEase) || maximumEase < 0 || maximumEase > .008) throw new Error("Cloth ease must be0..8mm");
    const controls = createArmourClothControls(worker.root, minimal, maximumEase, Number(values.iterations) > 0);
    let seed;
    if (values["seed-folder"]) {
      if (!minimal) throw new Error("A High cloth seed is only valid for coarse LOD fitting");
      const seedAssets = await createHatchAuditAssets({ armourFolder: values["seed-folder"] });
      try {
        const high = await seedAssets.soldier(record.nation, record.body, record.rank, false);
        high.root.scale.setScalar(WORKER_SCALE); high.setLod(0); high.root.updateMatrixWorld(true);
        seed = { ...seedArmourClothWeights(controls.vertices, createArmourClothControls(high.root, false)),
          hashes: Object.fromEntries(seedAssets.assets) };
        high.dispose();
      } finally { seedAssets.restore(); }
    }
    const samples = await createArmourSourceSamples(worker.root, record.body), poses: MotionClothPose[] = [];
    const labels = [], bodies: SkinnedMesh[] = [], knownPoses = new Map<string, number>();
    worker.root.traverse(node => { if ((node as SkinnedMesh).isSkinnedMesh && /^body(?:_|$)/.test(node.name)) bodies.push(node as SkinnedMesh); });
    for (const cell of record.cells) {
      const key = JSON.stringify([cell.diagnostics.posedMeshes, cell.diagnostics.skeletons].map(value => value),
        (_key, value) => typeof value === "number" ? Number(value.toFixed(8)) : value);
      const previous = knownPoses.get(key);
      if (previous !== undefined) {
        labels.push({ troop: cell.troop, name: cell.name, exposed: poses[previous]!.samples.length, poseIndex: previous });
        continue;
      }
      applyArmourPoseSnapshot(worker.root, cell.diagnostics);
      const points: Vector3[] = [], indices: number[] = [];
      for (const mesh of bodies) {
        const offset = points.length;
        points.push(...Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, vertex) => armourPointOf(mesh, vertex)));
        indices.push(...Array.from(mesh.geometry.index!.array, vertex => vertex + offset));
      }
      const grid = new TriangleGrid(points, indices), bone = (mesh: SkinnedMesh, name: string) =>
        new Vector3().setFromMatrixPosition(mesh.skeleton.bones.find(bone => bone.name === name)!.matrixWorld);
      const exposed = samples.flatMap(({ fraction, mesh, side, vertex }) => {
        const centre = bone(mesh, `${side}Arm`).lerp(bone(mesh, `${side}ForeArm`), fraction);
        const skin = armourPointOf(mesh, vertex), outward = skin.clone().sub(centre), radius = outward.length();
        const reach = .25 * WORKER_SCALE; outward.normalize();
        const hit = grid.raycast(centre.clone().addScaledVector(outward, reach), outward.clone().negate(), 0, reach);
        return hit && reach - hit.distance > radius + .0005 ? [] : [{ centre, skin }];
      });
      knownPoses.set(key, poses.length);
      labels.push({ troop: cell.troop, name: cell.name, exposed: exposed.length, poseIndex: poses.length });
      poses.push({ controls: armourClothControlPositions(controls.vertices),
        easeControls: armourClothEaseControls(controls.vertices), samples: exposed });
    }
    const fitOptions = { clearance: .003 * WORKER_SCALE, relaxation: Number(values.relaxation),
      iterations: Number(values.iterations), maximumStretch: 1.6, reach: .25 * WORKER_SCALE, strainAllowance: .003 * WORKER_SCALE };
    const fit = fitClothMotion(controls.vertices, controls.indices, poses, fitOptions);
    const receipt = { body: record.body, quality: record.quality, modelSha256: record.modelSha256,
      targetFolder: values["target-folder"] ?? folder, targetHashes: Object.fromEntries(assets.assets),
      fitOptions,
      seed,
      vertices: controls.vertices.length, movable: controls.vertices.filter(vertex => vertex.movable).length,
      sourceSamples: samples.length, passed: fit.passed, iterations: fit.iterations,
      uniquePoses: poses.length,
      maximumEase: Math.max(...fit.ease), easedVertices: fit.ease.filter(amount => amount > .0001).length,
      phases: labels.map(({ poseIndex, ...label }) => ({ ...label, before: fit.before[poseIndex], after: fit.after[poseIndex] })) };
    records.push(receipt);
    console.log(JSON.stringify({ body: record.body, quality: record.quality, passed: fit.passed,
      uniquePoses: poses.length, iterations: fit.iterations, maximumEase: receipt.maximumEase,
      minimumClearance: Math.min(...fit.after.map(phase => phase.minimumClearance)),
      failedPoses: fit.after.filter(phase => phase.missed || phase.skinViolations || phase.edgeViolations).length }));
    if (fit.passed) solutions.push({ body: record.body, rank: record.rank, quality: record.quality, passed: true,
      targetHashes: Object.fromEntries(assets.assets), poseModelSha256: record.modelSha256,
      vertices: controls.vertices.map((group, vertex) => ({ bones: group.bones, weights: fit.weights[vertex], ease: fit.ease[vertex],
        aliases: group.aliases.map(({ mesh, vertex: index }) => ({ mesh: mesh.name, vertex: index,
          before: new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), index).toArray(),
          delta: group.localEase.clone().multiplyScalar(fit.ease[vertex]!).toArray() })) })) });
    worker.dispose();
  } finally { assets.restore(); }
}
await writeFile(resolve(values.out), JSON.stringify({ scope: "Dry-run new-cloth joint-weight constraints on exact SHA-matched, equipped native matrices. Original body/geometry/UV/rig unchanged; no file mutation or visual acceptance.", records }, null, 2));
if (values.solution) {
  if (!records.length || records.some(record => !record.passed)) throw new Error("Failed or empty cloth fit cannot emit a solution");
  await writeFile(resolve(values.solution), JSON.stringify({ schema: 1, solutions }, null, 2));
}

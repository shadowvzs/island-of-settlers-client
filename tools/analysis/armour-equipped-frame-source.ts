import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PerspectiveCamera } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { locomotionClipTime } from "../../src/render-common/workers/worker-gait";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { captureArmourFitDiagnostics } from "../bench/armour-fit-diagnostics";
import { loadEquippedArmourCpu } from "./armour-equipped-cpu";
import { type ArmourPoseSampling, equippedArmourMotions } from "./armour-equipped-motions";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

/** Full-cycle production poses. No renderer; exact equipment/IK parity with AZ is independently recorded. */
export const createEquippedCpuFrames = async (options: { folder: string; bodies: string[]; ranks: string[];
  qualities: string[]; sourceFolder?: string; sampling?: ArmourPoseSampling }) => {
  if (!options.bodies.length || !options.ranks.length || !options.qualities.length
    || options.ranks.some(rank => !["recruit", "soldier", "centurion"].includes(rank))
    || options.qualities.some(quality => !["high", "minimal"].includes(quality)))
    throw new Error("Choose explicit valid military identities/ranks and High/Minimal details");
  if (options.sourceFolder && (!/^[a-z0-9-]+$/.test(options.sourceFolder)
    || options.ranks.length !== 1 || options.ranks[0] !== "recruit"))
    throw new Error("Source-clothes review requires a direct staging folder and the single recruit diagnostic rank");
  const ready = resolve("../island-of-settlers-worker-generation/game_ready"), folder = resolve(ready, options.folder);
  const manifest = JSON.parse(await readFile(resolve(folder, "manifest.json"), "utf8")), records = [];
  const native = await loadEquippedArmourCpu(), assets = await createHatchAuditAssets({ armourFolder: options.folder });
  const previousNow = performance.now.bind(performance), previousError = console.error, errors: unknown[][] = [];
  let clock = 0;
  Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
  console.error = (...args) => { errors.push(args); };
  try {
    for (const set of manifest.sets) for (const body of set.bodies) {
      if (!options.bodies.includes(body.id)) continue;
      for (const rank of options.ranks) for (const quality of options.qualities) {
        const minimal = quality === "minimal";
        const sourceModel = options.sourceFolder
          ? resolve(ready, options.sourceFolder, body.sourceBody ?? body.id, "model.glb") : undefined;
        const worker = sourceModel
          ? { ...await assets.pack.load(set.nation, body.id, pathToFileURL(sourceModel).href), setLod: (_lod: number) => {} }
          : await assets.soldier(set.nation, body.id, rank as "recruit", minimal);
        worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0);
        const pose = native.createWorkerPoser(worker), prop = native.createWorkerProp(assets.pack, worker, !minimal), cells = [];
        try {
          for (const troop of ["shield", "heavy", "archer"] as const) {
            const motions = equippedArmourMotions(options.sampling);
            for (const motion of motions) {
              const moving = motion.action === "walk" || motion.action === "run";
              const frame = { actorId: 1, nation: set.nation, variant: body.id, x: 0, y: 0, z: 0, heading: 0,
                selected: false, visible: true, action: motion.action, gaitPhase: motion.phase,
                runBlend: motion.runBlend,
                animationTime: moving ? locomotionClipTime(motion.action as "walk", motion.phase) : .6,
                target: null, workerJob: "Soldier", workerTool: { shield: "sword", heavy: "axe", archer: "bow" }[troop],
                armourRank: rank, carryingWare: null, combat: { attackProgress: motion.progress,
                  defending: motion.defending, doorMelee: false, faction: 0, type: troop, variant: 0 } } as WorkerFrame;
              for (let tick = 0; tick < 4; tick++) { clock += 1000; pose(frame); prop.update(frame); await Promise.resolve(); }
              if (errors.length) throw new Error(`CPU equipment failed: ${errors[0]!.map(String).join(" ")}`);
              const expected = { shield: "sword", heavy: "axe", archer: "bow" }[troop];
              if (!worker.root.getObjectByName(`military_${expected}`)?.visible) throw new Error("Actual CPU military gear is missing");
              cells.push({ troop, name: motion.name, frame,
                diagnostics: captureArmourFitDiagnostics(worker.root, new PerspectiveCamera(), false) });
            }
          }
        } finally { prop.dispose(); worker.dispose(); }
        const model = minimal && body.modelsMinimal ? body.modelsMinimal[rank] : body.models[rank];
        const modelPath = sourceModel ?? resolve(folder, model);
        const modelSha256 = createHash("sha256").update(await readFile(modelPath)).digest("hex");
        records.push({ body: body.id, nation: set.nation, rank, quality, modelPath, modelSha256, cells });
      }
    }
    for (const id of options.bodies) if (!records.some(record => record.body === id))
      throw new Error(`Requested CPU-equipped identity is missing: ${id}`);
    return { scope: "CPU production equipped poses, exact native parity baseline; atlas pixels omitted only", records };
  } finally {
    console.error = previousError; assets.restore(); native.restore();
    Object.defineProperty(performance, "now", { configurable: true, value: previousNow });
  }
};

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { SkinnedMesh } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { loadEquippedArmourCpu } from "./armour-equipped-cpu";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { review: { type: "string" }, out: { type: "string" } } });
if (!values.review || !values.out) throw new Error("Choose the exact native reference and parity output");
const input = JSON.parse(await readFile(values.review, "utf8")), records = [];
const native = await loadEquippedArmourCpu(), previousNow = performance.now.bind(performance);
const originalError = console.error, errors: unknown[][] = [];
console.error = (...args) => { errors.push(args); };
let clock = 0;
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
try {
  for (const record of input.records) {
    if (createHash("sha256").update(await readFile(record.modelPath)).digest("hex") !== record.modelSha256)
      throw new Error("Native reference model changed");
    const folder = record.modelPath.split("game_ready/")[1]!.split("/")[0]!;
    const assets = await createHatchAuditAssets({ armourFolder: folder });
    try {
      const minimal = record.quality === "minimal", worker = await assets.soldier(record.nation, record.body, record.rank, minimal);
      worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(minimal ? 1 : 0);
      const pose = native.createWorkerPoser(worker), prop = native.createWorkerProp(assets.pack, worker, !minimal), phases = [];
      try {
        for (const cell of record.cells) {
          for (let tick = 0; tick < 4; tick++) { clock += 1000; pose(cell.frame); prop.update(cell.frame); await Promise.resolve(); }
          if (errors.length) throw new Error(`CPU equipment load failed: ${errors[0]!.map(String).join(" ")}`);
          const expected = { shield: "sword", heavy: "axe", archer: "bow" }[cell.troop as "shield" | "heavy" | "archer"];
          const held = worker.root.getObjectByName(`military_${expected}`);
          if (!held?.visible) throw new Error(`CPU equipped pose is missing its actual ${expected} geometry`);
          worker.root.updateMatrixWorld(true);
          let maximumMatrixError = 0;
          for (const captured of cell.diagnostics.posedMeshes) {
            const mesh = worker.root.getObjectByName(captured.name) as SkinnedMesh;
            const skeleton = cell.diagnostics.skeletons[captured.skeleton];
            for (const [joint, reference] of skeleton.bones.entries()) {
              const actual = mesh.skeleton.bones[joint]!;
              if (actual.name !== reference.name) throw new Error("Equipped CPU/native joint order differs");
              actual.matrixWorld.elements.forEach((value, element) => {
                maximumMatrixError = Math.max(maximumMatrixError, Math.abs(value - reference.matrixWorld[element]));
              });
            }
          }
          phases.push({ troop: cell.troop, name: cell.name, maximumMatrixError });
        }
      } finally { prop.dispose(); worker.dispose(); }
      records.push({ body: record.body, quality: record.quality, modelSha256: record.modelSha256, phases });
      console.log(JSON.stringify(records.at(-1)));
    } finally { assets.restore(); }
  }
  const maximum = Math.max(...records.flatMap(record => record.phases.map(phase => phase.maximumMatrixError)));
  await writeFile(values.out, JSON.stringify({ scope: "CPU production poser plus actual production equipment geometry/placement/IK versus exact captured native matrices. Atlas pixels omitted only; no model/runtime mutation or GPU.", maximum, records }, null, 2));
  if (maximum > 1e-6) process.exitCode = 1;
} finally {
  console.error = originalError; native.restore();
  Object.defineProperty(performance, "now", { configurable: true, value: previousNow });
}

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";

const motionPilots = process.env.FOOT_PILOTS === "1";
const native = await loadCatapultCpuPoser(), assets = await createHatchAuditAssets({ motionPilots });
const original = performance.now.bind(performance); let clock = original();
Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
const reports = [];
try {
  for (const variant of ["roman-woman-grey", "roman-woman-olive", "roman-woman-pinafore"])
    for (const minimal of [false, true]) {
      const worker = await assets.civilian("roman", variant, minimal), pose = native.createWorkerPoser(worker);
      worker.root.updateMatrixWorld(true);
      const feet = ["Left", "Right"].map(side => ({ side,
        localUp: new Vector3(0, 1, 0).applyQuaternion(worker.root.getObjectByName(`${side}Foot`)!
          .getWorldQuaternion(new Quaternion()).invert()) }));
      const bones = ["Hips", ...["Left", "Right"].flatMap(side =>
        ["UpLeg", "Leg", "Foot", "ToeBase"].map(name => side + name))];
      const phases = [], rolls = [];
      for (let sample = 0; sample < 32; sample++) {
        const gaitPhase = sample / 32;
        const frame = { actorId: 1, nation: "roman", variant, visible: true, action: "walk", workerJob: "Carrier",
          carryingWare: null, gaitPhase, runBlend: 0, animationTime: gaitPhase * 3,
          heading: 0, x: 0, y: 0, z: 0, selected: false, target: null } as WorkerFrame;
        const snapshot = (action: string) => {
          const loaded = { ...frame, action, carryingWare: action === "walk" ? null : "logs" } as WorkerFrame;
          for (let tick = 0; tick < 4; tick++) { clock += 1000; pose(loaded); }
          worker.root.updateMatrixWorld(true);
          return bones.map(name => { const bone = worker.root.getObjectByName(name)!;
            return { name, position: bone.getWorldPosition(new Vector3()).toArray(),
              quaternion: bone.getWorldQuaternion(new Quaternion()).toArray() }; });
        };
        const walk = snapshot("walk");
        for (const foot of feet) {
          const ankle = worker.root.getObjectByName(`${foot.side}Foot`)!, toe = worker.root.getObjectByName(`${foot.side}ToeBase`)!;
          const forward = toe.getWorldPosition(new Vector3()).sub(ankle.getWorldPosition(new Vector3())).normalize();
          const normal = foot.localUp.clone().applyQuaternion(ankle.getWorldQuaternion(new Quaternion())).normalize();
          const wanted = new Vector3(0, 1, 0).addScaledVector(forward, -forward.y).normalize();
          const bank = Math.atan2(forward.dot(normal.clone().cross(wanted)), normal.dot(wanted));
          rolls.push({ gaitPhase, side: foot.side, bankDegrees: bank * 180 / Math.PI, normal: normal.toArray() });
        }
        for (const action of ["carry_back", "carry_shoulder"]) {
          const loaded = snapshot(action);
          let maximumTranslation = 0, maximumRotation = 0;
          for (const [index, baseline] of walk.entries()) {
            maximumTranslation = Math.max(maximumTranslation,
              new Vector3(...baseline.position).distanceTo(new Vector3(...loaded[index]!.position)));
            maximumRotation = Math.max(maximumRotation,
              new Quaternion(...baseline.quaternion).normalize().angleTo(new Quaternion(...loaded[index]!.quaternion).normalize()));
          }
          const differences = walk.map((baseline, index) => ({ name: baseline.name,
            translation: new Vector3(...baseline.position).distanceTo(new Vector3(...loaded[index]!.position)),
            rotation: new Quaternion(...baseline.quaternion).normalize().angleTo(new Quaternion(...loaded[index]!.quaternion).normalize()) }));
          phases.push({ gaitPhase, action, maximumTranslation, maximumRotation, differences });
        }
      }
      reports.push({ variant, detail: minimal ? "minimal" : "high", phases, rolls }); worker.dispose();
    }
  const folder = resolve("../resources/project-reviews/roman-loaded-feet-2026-11-03"); await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/cpu-review${motionPilots ? "-calibrated" : ""}.json`, JSON.stringify({ reports, assets: Object.fromEntries(assets.assets),
    scope: "Exact published Roman female loaded-vs-unloaded native lower-body bone parity over32 gait phases; native rendered foot appearance/contact still requires visual review" }, null, 2));
  const worst = reports.flatMap(report => report.phases.map(phase => ({ variant: report.variant, ...phase })))
    .toSorted((a, b) => b.maximumTranslation - a.maximumTranslation)[0]!;
  console.log(JSON.stringify({ cases: reports.length, phases: reports.reduce((sum, report) => sum + report.phases.length, 0), worst,
    rollRanges: reports.map(report => ({ variant: report.variant, detail: report.detail,
      ranges: ["Left", "Right"].map(side => ({ side,
        min: Math.min(...report.rolls.filter(roll => roll.side === side).map(roll => roll.bankDegrees)),
        max: Math.max(...report.rolls.filter(roll => roll.side === side).map(roll => roll.bankDegrees)) })) })) }));
  assert(worst.maximumTranslation < 1e-5 && worst.maximumRotation < 1e-5);
  if (motionPilots) assert(reports.every(report => report.rolls.every(roll => Math.abs(roll.bankDegrees) < 1)));
} finally { assets.restore(); native.restore(); Object.defineProperty(performance, "now", { configurable: true, value: original }); }

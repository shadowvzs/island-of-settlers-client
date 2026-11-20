import { expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

const walking = (commanderId?: string, mounted = false) => {
  const template = { nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0, heading: 0,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]);
  const actor = { uid: 0, x: 10, y: .2, z: 10, yaw: 0, mounted, visible: true, job: "Soldier",
    action: "walk", phase: "militaryField", ware: null, animationTime: 0, path: [], pathIndex: 0,
    building: -1, home: 0, timer: 0 } as SettlementActor;
  const soldier = { actor: 0, rank: 0, commanderId, combat: { type: "cavalry" as const,
    dismounted: !mounted, faction: 0, hp: 315, cooldown: 0 } };
  const update = (guard = 0) => frames.updateWorkers([actor], .05, [soldier], .5, undefined, { actor: 0, guard });
  update();
  return { actor, frames, update };
};

it.each([[0, -.07], [-.07, 0], [.07, 0]])(
  "keeps the foot commander's canonical facing when moving backward/sideways (%s,%s)", (dx, dz) => {
    const f = walking("commander-facing");
    for (let tick = 0; tick < 24; tick++) {
      f.actor.x += dx!; f.actor.z += dz!; f.update();
      expect(f.frames.workers[0]!.heading).toBeCloseTo(f.actor.yaw, 8);
      expect(f.actor.yaw).toBe(0);
      expect(f.frames.workers[0]!.armourRank).toBe("centurion");
    }
  }
);

it("preserves ordinary worker travel-facing behavior", () => {
  const f = walking();
  for (let tick = 0; tick < 24; tick++) { f.actor.z -= .07; f.update(); }
  expect(Math.abs(f.frames.workers[0]!.heading)).toBeGreaterThan(.5);
  expect(f.actor.yaw).toBe(0);
});

it("shows the authoritative manual guard on foot and clears it when it ends", () => {
  const f = walking("commander-guard");
  f.update(.5);
  expect(f.frames.workers[0]!.combat?.defending).toBe(true);
  expect(f.frames.workers[0]!.combat?.threatYaw).toBeUndefined();
  f.update();
  expect(f.frames.workers[0]!.combat?.defending).toBe(false);
});

it("raises the mounted guard from the same authoritative timer without an enemy attack", () => {
  const f = walking("commander-guard", true);
  for (let tick = 0; tick < 5; tick++) f.update(.5);
  const raised = f.frames.cavalryMounts[0]!.guard!;
  expect(raised).toBeGreaterThan(.8);
  for (let tick = 0; tick < 12; tick++) f.update();
  expect(f.frames.cavalryMounts[0]!.guard!).toBeLessThan(.01);
});

it("does not apply a commander guard receipt to an ordinary soldier", () => {
  const f = walking();
  f.update(.5);
  expect(f.frames.workers[0]!.combat?.defending).toBe(false);
});

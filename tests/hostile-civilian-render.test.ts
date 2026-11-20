import { expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

it("keeps a hostile Carrier in civilian handling with the enemy body across player nation changes", () => {
  const template = { nation: "roman", variant: "friendly", x: 0, y: 0, z: 0, heading: 0,
    selected: false, action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0,
    target: null } as WorkerFrame;
  const frames = createSettlementRenderFrames([template], () => [{ nation: "viking", variant: "enemy" }]);
  const actor = { uid: 9, x: 5, y: 0, z: 5, yaw: 0, job: "Carrier", action: "carry", visible: true,
    hostileCivilianFaction: 2, ware: "stone", phase: "inputReturn", building: 4, home: 4,
    animationTime: 0, path: [], pathIndex: 0 } as unknown as SettlementActor;
  frames.updateWorkers([actor], .05);
  expect(frames.workers[0]).toMatchObject({ nation: "viking", variant: "enemy", workerJob: "Carrier",
    civilianFaction: 2, carryingWare: "stone" });
  expect(frames.workers[0]!.combat).toBeUndefined();
  frames.setAppearances([{ nation: "chinese", variant: "friendly-change" }]);
  frames.updateWorkers([actor], .05);
  expect(frames.workers[0]).toMatchObject({ nation: "viking", variant: "enemy", civilianFaction: 2 });
  expect(frames.workers[0]!.combat).toBeUndefined();
});

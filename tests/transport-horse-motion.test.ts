import { describe, expect, it } from "vitest";

import { createTransportHorseMotion, holdLeadRopes } from "../src/app/settlement/transport-horse-motion";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { TransportHorseFrame } from "../src/shared/settlement/settlement-horses";

const horse = (id: number, extra: Partial<TransportHorseFrame> = {}): TransportHorseFrame =>
  ({ heading: 0, id, moving: false, visible: true, x: 1, y: 0, z: 1, ...extra });

describe("landing riders' horses in the transport horse layer (owner, 2026-10-15)", () => {
  it("hides a horse once it is no longer listed (its rider got on it)", () => {
    const motion = createTransportHorseMotion();
    expect(motion([horse(7)], 1, .05).map(frame => frame.visible)).toEqual([true]);
    expect(motion([], 1, .05)).toMatchObject([{ id: 7, visible: false }]);
    expect(motion([], 1, .05)).toEqual([]);
  });

  it("gives a rider holding his horse the lead rope, leaving carriers' ropes to the carriers", () => {
    const workers = [{ actorId: 3 }, { actorId: 4 }, { actorId: 5, horseLead: { horseId: 99 } }] as WorkerFrame[];
    holdLeadRopes(workers, [horse(10, { held: true, leader: 3 }), horse(11, { leader: 4 }),
      horse(12, { held: true, leader: 5 })]);
    expect(workers.map(worker => worker.horseLead?.horseId)).toEqual([10, undefined, 99]);
  });
});

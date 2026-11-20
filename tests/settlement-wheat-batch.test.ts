import { describe, expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import { createWheatMeshData, wheatPatchRadius } from "../src/render-common/wheat-field";
import { getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createSettlementFieldCycles } from "../src/shared/settlement/settlement-field-cycles";
import type { ResourceTarget, SettlementActor, SettlementBuilding, SettlementContext } from
  "../src/shared/settlement/settlement-types";
import { planWheatBatch } from "../src/shared/settlement/settlement-wheat-planning";

const farm = { uid: 1, typeId: 37, x: 8, z: 8, access: { x: 8, z: 8 }, input: {} } as SettlementBuilding;
const targets = (): ResourceTarget[] => Array.from({ length: 9 }, (_, i) => ({
  id: (8 + Math.floor(i / 3) * 2) * 24 + 8 + i % 3 * 2,
  x: 8.5 + i % 3 * 2, z: 8.5 + Math.floor(i / 3) * 2, kind: "field"
}));
describe("eight-plot wheat trips", () => {
  it("prefers eight neighbouring plots and uses smaller reachable batches when space or capacity is limited", () => {
    const candidates = targets();
    expect(planWheatBatch(candidates.slice(0, 7), farm, 0, target => [target])!.batch).toHaveLength(6);
    expect(planWheatBatch(candidates, farm, 17, target => [target])!.batch).toHaveLength(6);
    expect(planWheatBatch(candidates, farm, 0, target => target.id === candidates[1]!.id ||
      target.id === candidates[2]!.id ? null : [target])!.batch).toHaveLength(6);
    expect(planWheatBatch(candidates, farm, 24, target => [target])).toBeNull();
    expect(planWheatBatch(candidates, farm, 0, () => null)).toBeNull();
    const batch = planWheatBatch(candidates, farm, 0, target => [target])!;
    expect(batch.stage).toBe("sow");
    const plots = [batch.target, ...batch.batch!];
    expect(new Set(plots.map(plot => plot.id)).size).toBe(8);
    for (let i = 1; i < plots.length; i++) expect(plots.slice(0, i).some(plot =>
      Math.hypot(plot.x - plots[i]!.x, plot.z - plots[i]!.z) <= 2.9)).toBe(true);
  });
  it("uses separated reachable plots when no full connected cluster fits", () => {
    const candidates = targets().map((target, index) => ({ ...target, x: index * 4, z: 8 }));
    const result = planWheatBatch(candidates, farm, 0, target => [target])!;
    expect([result.target, ...result.batch!]).toHaveLength(8);
    expect(new Set([result.target, ...result.batch!].map(target => target.id)).size).toBe(8);
  });
  it("preserves saved growth fraction and takes exactly twice the old 60-second duration", () => {
    const context = { options: { world: { cellsX: 24, cellsZ: 24,
      walkCost: new Uint8Array(576).fill(10), buildClass: new Uint8Array(576).fill(4) },
      roads: { route: () => null }, findWorkerPath: (_from: unknown, to: unknown) => [to] },
      occupied: new Uint8Array(576), buildings: [farm], reservations: new Set() } as unknown as SettlementContext;
    const cycles = createSettlementFieldCycles(context), target = targets()[0]!;
    expect(cycles.complete(farm, target).success).toBe(true);
    cycles.update(60);
    expect(cycles.snapshot()[0]!.progress).toBe(.5);
    const restored = createSettlementFieldCycles(context);
    restored.restore(JSON.parse(JSON.stringify(cycles.snapshot())));
    restored.update(59.9);
    expect(restored.snapshot()[0]!.state).toBe("growing");
    restored.update(.1);
    expect(restored.snapshot()[0]!.state).toBe("ripe");
    expect(restored.snapshot()[0]!.progress).toBe(1);
  });
  it.each(["outbound", "work", "inside", "outputWalk"])("only equips the harvest scythe in %s", phase => {
    const frames = createSettlementRenderFrames([{ nation: "roman", variant: "male" } as WorkerFrame]);
    const actor = { uid: 0, visible: true, x: 0, y: 0, z: 0, yaw: 0, job: "Farmer", phase,
      action: phase === "work" ? "work" : "walk", tool: "scythe", ware: null,
      fieldWork: "sow", path: [], pathIndex: 0, timer: 0, animationTime: 0,
      building: 1, home: 0 } as SettlementActor;
    frames.updateWorkers([actor], .05);
    expect(getWorkerHeldProp(frames.workers[0]!)).toBeNull();
    actor.fieldWork = "harvest";
    frames.updateWorkers([actor], .05);
    expect(getWorkerHeldProp(frames.workers[0]!)?.id).toBe(["outbound", "work"].includes(phase) ? "scythe" : undefined);
    actor.ware = "grain"; actor.action = "carry";
    frames.updateWorkers([actor], .05);
    expect(getWorkerHeldProp(frames.workers[0]!)?.id).toBe("grain");
  });
  it("uses leafy detailed plants with grounded roots and much cheaper Minimal/far geometry", () => {
    const high = createWheatMeshData(42, true), minimal = createWheatMeshData(42, false);
    expect(high.positions.length).toBeGreaterThan(minimal.positions.length * 10);
    expect(high.flex.filter(height => height === 0).length).toBeGreaterThan(100);
    expect(Math.max(...high.flex)).toBeGreaterThan(.7);
    expect(wheatPatchRadius(0, 42)).not.toBe(wheatPatchRadius(Math.PI / 3, 42));
    expect(high.positions.length / 9).toBeLessThan(6500);
    expect(minimal.positions.length / 9).toBe(112);
  });
});

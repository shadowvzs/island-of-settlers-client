import { describe, expect, it } from "vitest";

import { createShipDemo } from "../src/app/settlement/ship-demo";
import { shipDeckBoxFits } from "../src/render-common/ships/ship-deck-layout";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";
import type { WorkerAppearance } from "../src/render-common/workers/worker-unit";

const ship: ShipFrame = { id: 1, x: 10, y: .18, z: 20, yaw: 0, phase: "idle", cargoCount: 0 };
const appearance = { nation: "roman", variant: "roman-man-blue" } as WorkerAppearance;

describe("render-only selected ship deck previews", () => {
  it("adds only transient rendering slots without replacing actual manifest fields", () => {
    const preview = createShipDemo(), frames = Object.freeze([Object.freeze({ ...ship })]);
    const original = JSON.stringify(frames);
    expect(preview.toggle(frames[0], "wares")).toBe(true);
    const rendered = preview.shipFrames(frames);
    expect(rendered[0]!.demoCrates!.length).toBeGreaterThan(0);
    expect(rendered[0]!.demoCrates!.every(slot => slot.kind === "crate" && shipDeckBoxFits(slot.bounds))).toBe(true);
    expect(rendered[0]!.cargoCount).toBe(0);
    expect(rendered[0]!.deckPassengers).toBeUndefined();
    expect(JSON.stringify(frames)).toBe(original);
  });
  it("renders independent settlers without inventing economic passengers or runtime actors", () => {
    const preview = createShipDemo(); preview.toggle(ship, "settlers");
    const workers = preview.workerFrames([ship], [appearance], "roman", 2);
    expect(workers.length).toBeGreaterThan(0);
    expect(new Set(workers.map(worker => worker.actorId)).size).toBe(workers.length);
    expect(workers.every(worker => worker.actorId! < -1000000 && worker.workerJob === "Settler")).toBe(true);
    expect(preview.shipFrames([ship])[0]!.deckPassengers).toBeUndefined();
    expect(preview.shipFrames([ship])[0]!.cargoCount).toBe(0);
  });
  it("refuses even zero-cargo ships that carry real passengers, troops or visible boxes", () => {
    for (const busy of [{ deckPassengers: 1 }, { deckTroops: [{ type: "shield" as const, rank: 0 }] },
      { deckBoxes: 1 }, { phase: "loading" as const }, { cargoCount: 1 }, { livery: "enemy" as const }]) {
      const preview = createShipDemo();
      expect(preview.toggle({ ...ship, ...busy }, "wares")).toBe(false);
      expect(preview.shipFrames([ship])[0]).toBe(ship);
    }
  });
  it("keeps only one preview and clears on departure, disappearance, explicit close and new session", () => {
    const preview = createShipDemo(), second = { ...ship, id: 2 };
    preview.toggle(ship, "wares"); preview.toggle(second, "settlers");
    expect(preview.active(ship.id)).toBeUndefined();
    expect(preview.active(second.id)).toBe("settlers");
    preview.reconcile([{ ...second, phase: "sailing" }]);
    expect(preview.active(second.id)).toBeUndefined();
    preview.toggle(ship, "wares"); preview.reconcile([]);
    expect(preview.active(ship.id)).toBeUndefined();
    preview.toggle(ship, "wares"); preview.clear();
    expect(preview.active(ship.id)).toBeUndefined();
    expect(createShipDemo().active(ship.id)).toBeUndefined();
  });
});

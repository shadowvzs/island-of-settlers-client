import { afterEach, describe, expect, it, vi } from "vitest";

import { reclaimIdleCarriers } from "../src/shared/settlement/settlement-idle-carriers";
import { compactRetiredSettlers } from "../src/shared/settlement/settlement-population";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { createProductionAttributionObserver } from "../tools/e2e/full/production-attribution-observer";

afterEach(() => vi.unstubAllGlobals());

const fixture = () => {
  let callback: (() => void) | undefined;
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (next: () => void) => { callback = next; return 1; });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const producer = { uid: 7, cycle: 0, worker: 90 };
  const storage = { uid: 1, typeId: 0, construction: 1, inventory: { logs: 0 },
    hasDoor: true, access: { x: 0, z: 0 } };
  const actor = { uid: 10, building: 7, job: "Carrier", phase: "pickup", ware: null as string | null,
    delivery: { source: 7, destination: 1, ware: "logs" } as
      { source: number; destination: number; ware: string } | undefined,
    home: 1, visible: true, x: 0, z: 0, handcart: undefined as { trip: object } | undefined };
  let actors = [actor];
  const sim = { buildings: () => [producer, storage], frames: () => actors } as unknown as
    Parameters<typeof createProductionAttributionObserver>[0];
  const observer = createProductionAttributionObserver(sim, 7, ["logs"], 17);
  const tick = () => callback!();
  const pickup = () => { actor.phase = "pickupTransfer"; actor.ware = "logs"; tick(); };
  const deliver = () => {
    actor.phase = "deliveryTransfer"; tick();
    actor.phase = "inside"; actor.ware = null; actor.delivery = undefined;
    storage.inventory.logs++; tick();
  };
  const retireAndCompact = () => {
    actor.phase = "inside"; actor.ware = null; actor.delivery = undefined; actor.visible = false;
    actor.building = storage.uid;
    storage.inventory.logs++;
    const context = { actors, buildings: [producer, storage], settlers: 0 } as unknown as SettlementContext;
    reclaimIdleCarriers(context);
    compactRetiredSettlers(context);
  };
  return { actor, cancel, deliver, observer, pickup, producer, retireAndCompact, storage, tick,
    removeActor: () => { actors = []; } };
};

describe("source-attributed production acceptance", () => {
  it("does not credit unrelated stock growth or cycle completion without an owned pickup", () => {
    const f = fixture();
    f.producer.cycle = 3; f.storage.inventory.logs = 100; f.tick();
    expect(f.observer.read()).toMatchObject({ cycles: 3, delivered: 0, evidence: [] });
    f.observer.stop();
  });

  it("requires the same carrier to finish a storage handoff and counts it once", () => {
    const f = fixture();
    f.pickup();
    expect(f.observer.read().delivered).toBe(0);
    f.deliver(); f.tick();
    expect(f.observer.read()).toMatchObject({ delivered: 1, pendingPickups: 0,
      evidence: [{ source: 7, destination: 1, actor: 10, ware: "logs", lastPhase: "deliveryTransfer" }] });
    // A returned evidence object cannot alter the observer's receipts.
    f.observer.read().evidence[0]!.source = 999;
    expect(f.observer.read().evidence[0]!.source).toBe(7);
    f.observer.stop();
  });

  it("does not attribute cargo from a different producer", () => {
    const f = fixture();
    f.actor.delivery!.source = 8; f.pickup(); f.deliver();
    expect(f.observer.read().delivered).toBe(0);
    f.observer.stop();
  });

  it("proves the same carrier's handoff when the real tick retires and compacts it before RAF", () => {
    const f = fixture();
    f.pickup(); f.actor.phase = "enterDelivery"; f.tick();
    f.retireAndCompact();
    expect(f.actor).toMatchObject({ phase: "retired", job: "Settler", home: 1 });
    f.tick(); f.tick();
    expect(f.observer.read()).toMatchObject({ delivered: 1, pendingPickups: 0,
      evidence: [{ actor: 10, source: 7, destination: 1, lastPhase: "enterDelivery",
        completionPhase: "retired", removedFromSimulation: true }] });
    f.observer.stop();
  });

  it("does not infer delivery from retirement at the pickup or unrelated stock growth", () => {
    const f = fixture();
    f.pickup(); f.retireAndCompact(); f.storage.inventory.logs += 100; f.tick();
    expect(f.observer.read()).toMatchObject({ delivered: 0, pendingPickups: 0 });
    f.observer.stop();
  });

  it("does not credit a vanished carrier whose cargo is still loaded", () => {
    const f = fixture();
    f.pickup(); f.actor.phase = "enterDelivery"; f.tick();
    f.removeActor(); f.storage.inventory.logs++; f.tick();
    expect(f.observer.read()).toMatchObject({ delivered: 0, pendingPickups: 0 });
    f.observer.stop();
  });

  it("does not credit cargo that was already loaded before observation", () => {
    const f = fixture();
    f.actor.ware = "logs"; f.actor.phase = "deliver"; f.tick(); f.deliver();
    expect(f.observer.read().delivered).toBe(0);
    f.observer.stop();
  });

  it("does not mistake a producer input handoff for a storage receipt", () => {
    const f = fixture();
    f.storage.typeId = 33; f.pickup(); f.deliver();
    expect(f.observer.read().delivered).toBe(0);
    f.observer.stop();
  });

  it("invalidates a pickup when its delivery is redirected", () => {
    const f = fixture();
    f.pickup(); f.actor.delivery!.source = 8; f.tick(); f.deliver();
    expect(f.observer.read()).toMatchObject({ delivered: 0, pendingPickups: 0 });
    f.observer.stop();
  });

  it("cannot reuse cancelled cargo as a later unrelated handoff", () => {
    const f = fixture();
    f.pickup(); f.actor.ware = null; f.actor.phase = "pickup"; f.tick();
    f.actor.ware = "logs"; f.actor.phase = "deliver"; f.tick(); f.deliver();
    expect(f.observer.read().delivered).toBe(0);
    f.observer.stop();
  });

  it("does not treat a cart batch or a vanished carrier as a completed unit delivery", () => {
    const f = fixture();
    f.actor.handcart = { trip: {} }; f.pickup(); f.deliver();
    expect(f.observer.read().delivered).toBe(0);
    f.actor.handcart = undefined; f.actor.ware = null;
    f.actor.delivery = { source: 7, destination: 1, ware: "logs" }; f.tick();
    f.pickup(); f.removeActor(); f.tick();
    expect(f.observer.read()).toMatchObject({ delivered: 0, pendingPickups: 0 });
    f.observer.stop();
  });

  it("cancels its RAF and ignores a callback already queued when stopped", () => {
    const f = fixture();
    f.observer.stop(); f.producer.cycle = 3; f.tick();
    expect(f.cancel).toHaveBeenCalledWith(1);
    expect(f.observer.read().cycles).toBe(0);
  });
});

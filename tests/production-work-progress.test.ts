import { describe, expect, it } from "vitest";

import { productionWorkProgress } from "../src/app/settlement/production-work-progress";
import { createFellingController } from "../src/render-common/felling/tree-felling";
import { FISHING_WORK_TIMING, FORESTER_PLANT_SECONDS } from "../src/shared/settlement/outdoor-work-timing";
import { getProductionRule } from "../src/shared/settlement/production-rules";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { WHEAT_SOW_SECONDS } from "../src/shared/settlement/settlement-wheat-planning";

const building = (typeId: number, extra: Partial<SettlementBuilding> = {}) =>
  ({ construction: 1, typeId, ...extra }) as SettlementBuilding;
const worker = (phase: string, timer: number, extra: Partial<SettlementActor> = {}) =>
  ({ action: "work", phase, timer, ...extra }) as SettlementActor;
const report = (type: number, actor: SettlementActor, extra: Partial<SettlementBuilding> = {}) =>
  productionWorkProgress(building(type, extra), actor, getProductionRule(type));

describe("production work progress from authoritative clocks", () => {
  it("uses the committed recipe duration even after selection and upgrade changes", () => {
    const actor = worker("work", 8, { productionSeconds: 16, productionOutput: "hardwoodPlanks" });
    expect(report(33, actor, { selectedOutput: "mahoganyPlanks", workshopUpgrade: { level: 4 } }))
      .toEqual({ workProgress: .5, workProgressLabel: "Working" });
    expect(report(33, structuredClone(actor))).toEqual(report(33, actor));
  });
  it.each([20, 41, 45, 49, 53])("reads actual planting time for nursery %s, including upgrades", type => {
    expect(report(type, worker("foresterPlant", FORESTER_PLANT_SECONDS / 2, { productionSeconds: 20 }),
      { workshopUpgrade: { level: 1 } })).toEqual({ workProgress: .5, workProgressLabel: "Planting" });
  });
  it("keeps one monotonic fishing cycle across cast, wait and reel transitions", () => {
    const { cast, reel, wait } = FISHING_WORK_TIMING;
    const readings = [worker("fishCast", cast), worker("fishCast", 0), worker("fishWait", wait),
      worker("fishWait", 0), worker("fishReel", reel), worker("fishReel", 0)]
      .map(actor => report(18, actor).workProgress);
    expect(readings).toEqual([0, .2, .2, .67, .67, 1]);
  });
  it("uses the short actual sowing duration rather than the crop's harvest duration", () => {
    expect(report(37, worker("work", WHEAT_SOW_SECONDS / 2, { fieldWork: "sow", productionSeconds: 24 })))
      .toEqual({ workProgress: .5, workProgressLabel: "Sowing" });
  });
  it("distinguishes bow release and arrow flight without claiming a successful hunt", () => {
    expect(report(22, worker("huntAim", 1))).toEqual({ workProgress: .5, workProgressLabel: "Drawing the bow" });
    const arrow = { duration: 2 } as NonNullable<SettlementActor["huntArrow"]>;
    expect(report(22, worker("huntFlight", 1, { action: "idle", huntArrow: arrow })))
      .toEqual({ workProgress: .5, workProgressLabel: "Arrow in flight" });
  });
  it("reads the felling controller without advancing it, including restored saved state", () => {
    const controller = createFellingController(); controller.fell(9, 10, .5);
    const saved = structuredClone(controller.saveState());
    const b = building(42), actor = worker("waitTreeFall", 0,
      { target: { id: 9, kind: "tree", x: 1, z: 2 } });
    const before = productionWorkProgress(b, actor, getProductionRule(42), id => controller.getWorkProgress(id, 11));
    expect(before.workProgressLabel).toBe("Chopping");
    expect(before.workProgress).toBeGreaterThan(0);
    expect(controller.saveState()).toEqual(saved);
    const restored = createFellingController(); restored.loadState(saved);
    expect(productionWorkProgress(b, actor, getProductionRule(42), id => restored.getWorkProgress(id, 11)))
      .toEqual(before);
    expect(controller.getWorkProgress(9, 100)).toBeUndefined();
  });
  it.each(["inside", "workSearchWait", "inputFetchBlocked", "outbound", "huntChase", "huntWait", "rest"])
  ("shows no invented progress during %s", phase => {
    expect(report(33, worker(phase, 1), { productionPaused: true })).toEqual({});
  });
  it("retains progress while a paused workshop finishes its already committed cycle", () => {
    expect(report(33, worker("work", 5, { productionSeconds: 10 }), { productionPaused: true }).workProgress)
      .toBe(.5);
  });
  it("excludes construction, storage, military and idle blocked work", () => {
    for (const type of [0, 1, 2, 4, 9, 14, 29, 39, 40]) expect(report(type, worker("work", 1))).toEqual({});
    expect(report(33, worker("work", 1), { construction: .9 })).toEqual({});
    expect(report(33, worker("work", 1, { action: "idle" }))).toEqual({});
    expect(report(33, worker("work", Number.NaN))).toEqual({});
  });
});

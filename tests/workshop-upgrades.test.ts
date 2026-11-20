import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BUILDING_LEVEL_STEPS } from "../src/shared/balance/building-levels";
import { PRODUCTION_SPEED_FACTOR } from "../src/shared/balance/economy";
import { workshopUpgradeLevels } from "../src/shared/settlement/building-level-benefits";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import type { SettlementActor, SettlementBuilding,SettlementContext } from "../src/shared/settlement/settlement-types";
import { updateWorker } from "../src/shared/settlement/settlement-workers";
import {
  cancelWorkshopUpgrade, doorBlowDamage, finishWorkshopUpgrade, lookoutSightFactor, militaryDoorFactor,
  requestWorkshopUpgrade, tavernTrainingFactor, territoryRadius, updateWorkshopUpgrade, validWorkshopUpgrade,
  workerCycleRate, workshopCycleFactor, workshopUpgradeCost, workshopUpgradeDemand
} from "../src/shared/settlement/workshop-upgrades";
import { workshopUpgradeFixture } from "./helpers/workshop-upgrade-fixture";

const UPGRADE_STOCK = { hardwoodLogs: 4, hardwoodPlanks: 4, marble: 2 };
const fixture = (type = 33, carts = false) => workshopUpgradeFixture(type, UPGRADE_STOCK, carts);
const workshop = (extra: Partial<SettlementBuilding> = {}) => ({
  typeId: 33, construction: 1, input: {}, output: {}, incoming: {}, ...extra
}) as SettlementBuilding;
describe("optional workshop shelves", () => {
  it("leaves production stock untouched until escrow is fully paid, then offers the next level", () => {
    const building = workshop({ typeId: 25, cycle: 7, constructionConsumed: { planks: 5 }, output: { tool: 8 },
      input: { planks: 2, iron: 1 } });
    expect(workshopCycleFactor(building)).toBe(1);
    expect(requestWorkshopUpgrade(building)).toBe(true);
    building.workshopUpgrade!.reserved = { hardwoodPlanks: 4, marble: 1 };
    expect(finishWorkshopUpgrade(building)).toBe(false);
    updateWorkshopUpgrade(building);
    expect(building.input).toEqual({ planks: 2, iron: 1 });
    expect(workshopCycleFactor(building)).toBe(1);
    building.workshopUpgrade!.reserved.marble = 2;
    expect(finishWorkshopUpgrade(building)).toBe(true);
    expect(building.input).toEqual({ planks: 2, iron: 1 });
    expect(workshopCycleFactor(building)).toBe(1.1);
    // Legacy stock above the six-item shelf is kept; it only blocks new cycles.
    expect(building.output).toEqual({ tool: 8 });
    expect(building.cycle).toBe(7); expect(building.construction).toBe(1);
    expect(building.constructionConsumed).toEqual({ planks: 5 });
    expect(cancelWorkshopUpgrade(building)).toBe(false);
    expect(requestWorkshopUpgrade(building)).toBe(true);
    expect(workshopUpgradeCost(building)).toEqual({ cedarPlanks: 5, limestone: 3 });
  });
  it("offers player military buildings, lookout and tavern levels, never unknown or hostile sites", () => {
    for (const typeId of [1, 2, 4, 9, 14, 40])
      expect(requestWorkshopUpgrade(workshop({ typeId })), `type ${typeId}`).toBe(true);
    for (const typeId of [1000]) expect(requestWorkshopUpgrade(workshop({ typeId })), `type ${typeId}`).toBe(false);
    expect(requestWorkshopUpgrade(workshop({ construction: .5 }))).toBe(false);
    expect(requestWorkshopUpgrade(workshop({ typeId: 4, militaryFaction: 1 }))).toBe(false);
  });
  it("preserves legacy pending input-funded deliveries and cancels late cargo without loss or duplication", () => {
    const building = workshop({ typeId: 25, input: { hardwoodPlanks: 2 },
      incoming: { hardwoodPlanks: 2, marble: 1 }, workshopUpgrade: { level: 0, requested: true } });
    expect(workshopUpgradeDemand(building)).toEqual({ hardwoodPlanks: 0, marble: 1 });
    expect(cancelWorkshopUpgrade(building)).toBe(true);
    expect(workshopUpgradeDemand(building)).toEqual({});
    updateWorkshopUpgrade(building); updateWorkshopUpgrade(building);
    expect(building.output.hardwoodPlanks).toBe(2);
    expect(requestWorkshopUpgrade(building)).toBe(false);
    Object.assign(building.input, { hardwoodPlanks: 2, marble: 1 }); building.incoming = {};
    updateWorkshopUpgrade(building); updateWorkshopUpgrade(building);
    expect(building.output).toEqual({ hardwoodPlanks: 4, marble: 1 });
    expect(building.workshopUpgrade).toBeUndefined();
    expect(requestWorkshopUpgrade(building)).toBe(true);
  });
  it("cancels a captured pending workshop without granting its benefit", () => {
    const building = workshop({ input: { logs: 3 } });
    requestWorkshopUpgrade(building);
    building.workshopUpgrade!.reserved = { hardwoodLogs: 4, marble: 2 };
    building.militaryFaction = 1;
    updateWorkshopUpgrade(building);
    expect(building.output).toEqual({ hardwoodLogs: 4, marble: 2 });
    expect(building.input).toEqual({ logs: 3 });
    expect(workshopCycleFactor(building)).toBe(1);
  });
  it("rejects fabricated or inconsistent upgrade metadata", () => {
    expect(validWorkshopUpgrade(workshop())).toBe(true);
    expect(validWorkshopUpgrade(workshop({ workshopUpgrade: { level: 1 } }))).toBe(true);
    expect(validWorkshopUpgrade(workshop({ typeId: 25, workshopUpgrade: { level: 4 } }))).toBe(true);
    expect(validWorkshopUpgrade(workshop({ workshopUpgrade: { level: 2 } }))).toBe(true);
    expect(validWorkshopUpgrade(workshop({ typeId: 25, workshopUpgrade: { level: 3, requested: true } }))).toBe(true);
    for (const upgrade of [null, { level: 5 }, { level: 0 }, { level: 4, requested: true },
      { level: 0, requested: true, cancelling: true }, { level: 1, extra: 1 }])
      expect(validWorkshopUpgrade(workshop({ workshopUpgrade: upgrade as never }))).toBe(false);
    expect(validWorkshopUpgrade(workshop({ typeId: 7, workshopUpgrade: { level: 1 } }))).toBe(false);
    expect(validWorkshopUpgrade(workshop({ typeId: 4, workshopUpgrade: { level: 1 } }))).toBe(true);
    expect(validWorkshopUpgrade(workshop({ typeId: 4, workshopUpgrade: { level: 4 } }))).toBe(true);
    expect(validWorkshopUpgrade(workshop({ typeId: 4, workshopUpgrade: { level: 5 as never } }))).toBe(false);
    // Escrow above the level's own cost (level 3 → 4 costs 6 walnut planks) is fabricated.
    expect(validWorkshopUpgrade(workshop({ typeId: 25, workshopUpgrade: { level: 2, requested: true,
      reserved: { walnutPlanks: 6, basalt: 4 }, incoming: {} } }))).toBe(true);
    expect(validWorkshopUpgrade(workshop({ typeId: 25, workshopUpgrade: { level: 2, requested: true,
      reserved: { walnutPlanks: 7 }, incoming: {} } }))).toBe(false);
    expect(validWorkshopUpgrade(workshop({ typeId: 25, workshopUpgrade: { level: 2, requested: true,
      reserved: { hardwoodPlanks: 1 }, incoming: {} } }))).toBe(false);
  });
  it("fetches materials using existing carriers and survives reload in both phases", () => {
    const { advance, building, simulation, total } = fixture();
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
    advance(300, () => building.workshopUpgrade?.level === 1);
    expect(building.workshopUpgrade).toEqual({ level: 1 });
    expect(total("hardwoodLogs")).toBe(0); expect(total("marble")).toBe(0);
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const restored = simulation.buildings().find(entry => entry.uid === building.uid)!;
    expect(workshopCycleFactor(restored)).toBe(1.1);
    expect(saved.buildings.find(entry => entry.uid === building.uid)!.workshopUpgrade).toEqual({ level: 1 });
  });
  it.each([4, 14, 40])("upgrades building %i through the same carrier, escrow and builder flow", type => {
    const { advance, building, simulation, total } = fixture(type);
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
    advance(300, () => building.workshopUpgrade?.level === 1);
    expect(building.workshopUpgrade).toEqual({ level: 1 });
    expect(total("hardwoodPlanks")).toBe(0); expect(total("marble")).toBe(0);
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(false);
  });
  it("requires reachable stock and holds the cost against a second upgrade", () => {
    const { building, simulation } = fixture();
    simulation.headquarters.inventory.marble = 1;
    expect(simulation.workshopUpgradeAvailability(building.uid)?.available).toBe(false);
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(false);
    simulation.headquarters.inventory.marble = 2;
    expect(simulation.workshopUpgradeAvailability(building.uid)?.available).toBe(true);
    const [width, depth] = getBuildingDefinition(33).gridFootprint;
    const other = simulation.placeBuilding(33, 43 + width % 2 / 2, 22 + depth % 2 / 2).building!;
    expect(other).toBeDefined();
    Object.assign(other, { construction: 1, required: {} });
    expect(simulation.requestWorkshopUpgrade(other.uid)).toBe(false);
    expect(simulation.connectRoads(simulation.headquarters.access, other.access)).toBe(true);
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
    expect(simulation.requestWorkshopUpgrade(other.uid)).toBe(false);
  });
  it("waits after delivery without a hammer, then saves and resumes real builder work", () => {
    const { advance, building, simulation, total } = fixture();
    simulation.headquarters.inventory.hammer = 0;
    expect(simulation.requestWorkshopUpgrade(building.uid)).toBe(true);
    advance(300);
    expect(building.workshopUpgrade?.reserved?.hardwoodLogs).toBe(4);
    expect(building.workshopUpgrade?.reserved?.marble).toBe(2);
    expect(building.workshopUpgrade?.level).toBe(0);
    expect(building.workshopUpgrade?.progress ?? 0).toBe(0);
    expect(workshopCycleFactor(building)).toBe(1);
    const productionWorker = building.worker;
    simulation.headquarters.inventory.hammer = 1;
    advance(120, () => (building.workshopUpgrade?.progress ?? 0) > 0);
    expect(building.workshopUpgrade?.progress).toBeGreaterThan(0);
    expect(building.worker).toBe(productionWorker);
    expect(total("hardwoodLogs")).toBe(4);
    const builder = simulation.frames().find(actor => actor.uid === building.workshopUpgrade?.builder)!;
    expect(builder.job).toBe("Builder");
    expect(builder.visible).toBe(true);
    expect(builder.action).toBe("work");
    const progress = building.workshopUpgrade!.progress;
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    const restored = simulation.buildings().find(entry => entry.uid === building.uid)!;
    expect(restored.workshopUpgrade?.progress).toBe(progress);
    advance(180, () => restored.workshopUpgrade?.level === 1);
    expect(restored.workshopUpgrade).toEqual({ level: 1 });
    expect(restored.worker).toBe(productionWorker);
    expect(total("hardwoodLogs")).toBe(0);
    expect(total("marble")).toBe(0);
    advance(120);
    expect(simulation.headquarters.inventory.hammer).toBe(1);
    expect(simulation.frames().filter(actor => actor.job === "Builder" && actor.phase !== "retired")).toHaveLength(0);
  });
  it("cancels during hammering and returns the builder, hammer and every delivered material", () => {
    const { advance, building, simulation, total } = fixture();
    simulation.requestWorkshopUpgrade(building.uid);
    advance(300, () => (building.workshopUpgrade?.progress ?? 0) > 0);
    expect(building.workshopUpgrade?.progress).toBeGreaterThan(0);
    simulation.cancelWorkshopUpgrade(building.uid);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    advance(300);
    const restored = simulation.buildings().find(entry => entry.uid === building.uid)!;
    expect(restored.workshopUpgrade).toBeUndefined();
    expect(workshopCycleFactor(restored)).toBe(1);
    expect(total("hardwoodLogs")).toBe(4);
    expect(total("marble")).toBe(2);
    expect(simulation.headquarters.inventory.hammer).toBe(1);
  });
  it("preserves materials and the builder tool when demolished during upgrading", () => {
    const { advance, building, simulation, total } = fixture();
    simulation.requestWorkshopUpgrade(building.uid);
    advance(300, () => (building.workshopUpgrade?.progress ?? 0) > 0);
    expect(building.workshopUpgrade?.progress).toBeGreaterThan(0);
    expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
    advance(300);
    expect(total("hardwoodLogs")).toBe(4);
    expect(total("marble")).toBe(2);
    expect(simulation.headquarters.inventory.hammer).toBe(1);
  });
  it("cancels real deliveries during transit then refunds every item once", () => {
    const { advance, building, simulation, total } = fixture();
    simulation.requestWorkshopUpgrade(building.uid);
    advance(40, () => (building.incoming.hardwoodLogs ?? 0) > 0);
    expect(building.incoming.hardwoodLogs).toBeGreaterThan(0);
    expect(simulation.cancelWorkshopUpgrade(building.uid)).toBe(true);
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(300);
    const restored = simulation.buildings().find(entry => entry.uid === building.uid)!;
    expect(restored.workshopUpgrade).toBeUndefined();
    expect(workshopCycleFactor(restored)).toBe(1);
    expect(total("hardwoodLogs")).toBe(4); expect(total("marble")).toBe(2);
  });
  it("preserves legacy pending cart cargo and prepaid reservations across cancellation and reload", () => {
    const { advance, building, simulation, total } = fixture(33, true);
    // Pending saves without escrow keep their cart transport.
    building.workshopUpgrade = { level: 0, requested: true };
    advance(100, () => simulation.frames().some(actor => (actor.handcart?.trip?.loaded ?? 0) > 0));
    expect(simulation.frames().some(actor => (actor.handcart?.trip?.loaded ?? 0) > 0)).toBe(true);
    expect(total("hardwoodLogs")).toBe(4); expect(total("marble")).toBe(2);
    simulation.cancelWorkshopUpgrade(building.uid);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    advance(400);
    expect(total("hardwoodLogs")).toBe(4); expect(total("marble")).toBe(2);
    expect(simulation.buildings().find(entry => entry.uid === building.uid)!.workshopUpgrade).toBeUndefined();
  });
  it("salvages upgrade materials exactly once on demolition with an incoming carrier", () => {
    const { advance, building, simulation, total } = fixture();
    simulation.requestWorkshopUpgrade(building.uid);
    advance(50, () => (building.incoming.hardwoodLogs ?? 0) > 0);
    expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
    advance(300);
    expect(total("hardwoodLogs")).toBe(4); expect(total("marble")).toBe(2);
  });
  it("loads an old upgraded workshop holding its former 8-item buffer without losing stock", () => {
    const { building, simulation } = fixture();
    building.workshopUpgrade = { level: 1 };
    building.output = { planks: 8 };
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const restored = simulation.buildings().find(entry => entry.uid === building.uid)!;
    expect(restored.output).toEqual({ planks: 8 });
    expect(restored.workshopUpgrade).toEqual({ level: 1 });
    expect(workshopCycleFactor(restored)).toBe(1.1);
  });
  it("keeps the shared six-item shelf for an upgraded multi-product workshop", () => {
    const { advance, building, roads, simulation } = fixture(24);
    building.input = { iron: 20, coal: 20 };
    building.workshopUpgrade = { level: 1 };
    // Recruit the tool-carrying worker on the road first; then remove the access road so the
    // filled output shelf cannot be drained into shared storage during the observation window.
    advance(600, () => simulation.frames().some(actor => actor.job === "Armorer"));
    roads.replaceSegments([]);
    advance(600, () => building.status === "Output stock full");
    expect(Object.values(building.output).reduce((sum, count) => sum + count, 0)).toBe(6);
    expect(building.status).toBe("Output stock full");
  });
  it("preserves pending drink workshop payments across the legacy input migration", () => {
    const { building, simulation } = fixture(6);
    simulation.headquarters.inventory.hardwoodPlanks = 1;
    building.input.hardwoodPlanks = 3;
    building.workshopUpgrade = { level: 0, requested: true };
    const saved = simulation.saveState();
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.buildings().find(entry => entry.uid === building.uid)!.input.hardwoodPlanks).toBe(3);
  });
});


describe("producer upgrade coverage", () => {
  it("speeds every producer, nursery and stable by the shared factor, and nothing else", () => {
    for (const [id, rule] of Object.entries(PRODUCTION_RULES)) {
      const typeId = Number(id);
      const producer = (rule.outputs.length > 0 && !rule.service) || rule.outdoor === "plant";
      const building = workshop({ typeId });
      if (!producer) { expect(workshopCycleFactor({ typeId, workshopUpgrade: { level: 1 } })).toBe(1); continue; }
      expect(workshopCycleFactor(building), `building ${id}`).toBe(1);
      expect(requestWorkshopUpgrade(building), `building ${id}`).toBe(true);
      expect(workshopCycleFactor(building), `pending ${id}`).toBe(1);
      building.workshopUpgrade!.reserved = workshopUpgradeCost(building);
      expect(finishWorkshopUpgrade(building)).toBe(true);
      expect(workshopCycleFactor(building), `building ${id}`).toBe(1.1);
    }
    for (const level of [1, 2, 3, 4] as const) for (const typeId of [17, 25, 33])
      expect(workshopCycleFactor({ typeId, workshopUpgrade: { level } })).toBeCloseTo(1 + level / 10, 9);
    expect(workshopCycleFactor({ typeId: 0, workshopUpgrade: { level: 1 } })).toBe(1);
    expect(workshopCycleFactor({ typeId: 33, workshopUpgrade: { level: 1 }, militaryFaction: 2 })).toBe(1);
  });
  it("speeds only the building's own worker during in-place work, never its walks", () => {
    const building = workshop({ uid: 3, typeId: 35, worker: 1, workshopUpgrade: { level: 1 } });
    const context = { buildings: [building] };
    const rate = (uid: number, phase: string) => workerCycleRate(context, { uid, building: 3, phase });
    for (const phase of ["work", "rest", "wellWork", "fishWait", "foresterPlant", "waitTreeFall", "pigFeedPutdown"])
      expect(rate(1, phase), phase).toBe(1.1 * PRODUCTION_SPEED_FACTOR);
    for (const phase of ["outbound", "outputWalk", "outputPutdown", "inputPickup", "returnWork", "huntFlight"])
      expect(rate(1, phase), phase).toBe(1);
    expect(rate(2, "work")).toBe(1);
    building.workshopUpgrade = undefined;
    expect(rate(1, "work")).toBe(PRODUCTION_SPEED_FACTOR);
  });
  it("plays an upgraded well's whole windlass cycle and its clip clock 10% faster in sync", () => {
    const run = (upgraded: boolean) => {
      const { advance, building, simulation } = fixture(35);
      if (upgraded) building.workshopUpgrade = { level: 1 };
      advance(120, () => simulation.frames().some(actor => actor.phase === "wellWork"));
      const worker = () => simulation.frames().find(actor => actor.uid === building.worker)!;
      let seconds = 0;
      while (worker().phase === "wellWork") {
        simulation.update(.05); seconds += .05;
        if (worker().phase === "wellWork") expect(worker().animationTime).toBeCloseTo(building.workTime!, 6);
      }
      return seconds;
    };
    // Production times are halved (BAL-01); the upgrade adds its 10% on top.
    expect(run(false)).toBeCloseTo(14 / PRODUCTION_SPEED_FACTOR, 0);
    expect(run(true)).toBeCloseTo(14 / 1.1 / PRODUCTION_SPEED_FACTOR, 0);
  });
});

describe("level benefits and non-workshop upgrades", () => {
  it("describes every level 2–5 from the building-levels table", () => {
    const benefits = (typeId: number) => workshopUpgradeLevels(typeId).map(entry => entry.benefits);
    expect(workshopUpgradeLevels(26).map(entry => entry.level)).toEqual([2, 3, 4, 5]);
    expect(benefits(26)).toEqual([["+10% work speed"], ["+20% work speed"], ["+30% work speed"], ["+40% work speed"]]);
    expect(benefits(20)[0]).toEqual(["+10% work speed"]);
    expect(benefits(0)).toEqual([250, 500, 750, 1000].map(extra =>
      [`+${extra / 10}% storage: 1000 → ${1000 + extra} per ware`]));
    expect(benefits(29)[0]).toEqual(["+25% storage: 500 → 625 per ware"]);
    expect(benefits(39)[0]).toEqual(["+25% storage: 500 → 625 per ware", "+10% dock porter speed"]);
    expect(benefits(39)[3]).toEqual(["+100% storage: 500 → 1000 per ware", "+40% dock porter speed",
      "a second berth where the shore allows"]);
    expect(benefits(14)).toEqual([["+15% sight radius"], ["+30% sight radius"], ["+45% sight radius"],
      ["+60% sight radius"]]);
    expect(benefits(40)[3]).toEqual(["+40% recruitment speed"]);
    expect(benefits(4)).toEqual([
      ["+15% door strength", "+10% territory: radius 39 → 43"], ["+30% door strength", "+20% territory: radius 39 → 47"],
      ["+45% door strength", "+30% territory: radius 39 → 51"], ["+60% door strength", "+40% territory: radius 39 → 55"]]);
    expect(benefits(33)).toEqual([
      ["+10% work speed", "Unlocks hardwood planks"], ["+20% work speed", "Unlocks cedar planks"],
      ["+30% work speed", "Unlocks walnut planks"], ["+40% work speed", "Unlocks mahogany planks"]]);
    for (const typeId of [42, 46, 50, 54]) expect(benefits(typeId)[3]).toEqual(["+40% work speed"]);
    for (const typeId of [7, 1000]) expect(workshopUpgradeLevels(typeId)).toEqual([]);
  });
  it("applies lookout, tavern, door and territory factors only to completed player upgrades", () => {
    const done = { workshopUpgrade: { level: 1 as const } };
    expect(lookoutSightFactor({ typeId: 14, ...done })).toBe(1 + BUILDING_LEVEL_STEPS.sight);
    expect(tavernTrainingFactor({ typeId: 40, ...done })).toBe(1.1);
    expect(militaryDoorFactor({ typeId: 9, ...done })).toBe(1 + BUILDING_LEVEL_STEPS.door);
    expect(militaryDoorFactor({ typeId: 9, ...done, militaryFaction: 1 })).toBe(1);
    expect(militaryDoorFactor(undefined)).toBe(1);
    // 15% more door strength: a 200 hp door takes 23 ordinary blows instead of 20; attackers' doors never.
    expect(200 / doorBlowDamage(10, 0, { typeId: 4, ...done })).toBeCloseTo(23, 9);
    expect(doorBlowDamage(20, 0, { typeId: 4 })).toBe(20);
    expect(doorBlowDamage(20, 1, { typeId: 4, ...done })).toBe(20);
    expect([1, 2, 4, 9].map(typeId => territoryRadius({ typeId, ...done }))).toEqual([22, 32, 43, 58]);
    // Pending (level 0) never changes the claim; the HQ's radius is not a military upgrade.
    expect(territoryRadius({ typeId: 4, workshopUpgrade: { level: 0, requested: true } })).toBe(39);
    expect(territoryRadius({ typeId: 0, workshopUpgrade: { level: 4 } })).toBe(48);
    for (const [factor, typeId] of [[lookoutSightFactor, 40], [tavernTrainingFactor, 14]] as const)
      expect(factor({ typeId, ...done })).toBe(1);
  });
  it("grows every per-level factor linearly up to level 5", () => {
    const at = (typeId: number, level: 1 | 2 | 3 | 4) => ({ typeId, workshopUpgrade: { level } });
    const linear = (step: number) => [1, 2, 3, 4].map(level => 1 + step * level);
    [1, 2, 3, 4].forEach((level, index) => {
      expect(lookoutSightFactor(at(14, level as 1))).toBeCloseTo(linear(BUILDING_LEVEL_STEPS.sight)[index]!, 9);
      expect(militaryDoorFactor(at(2, level as 1))).toBeCloseTo(linear(BUILDING_LEVEL_STEPS.door)[index]!, 9);
    });
    expect(tavernTrainingFactor(at(40, 4))).toBeCloseTo(1.4, 9);
    expect([1, 2, 4, 9].map(typeId => territoryRadius(at(typeId, 4)))).toEqual([28, 41, 55, 74]);
    expect(territoryRadius({ ...at(9, 4), militaryFaction: 1 })).toBe(53);
    expect(200 / doorBlowDamage(10, 0, at(4, 4))).toBeCloseTo(32, 9);
  });
});

it("deposits a harvest above the soft threshold, crediting it once", () => {
  const building = workshop({ uid: 7, typeId: 37, access: { x: 10, z: 10 },
    workshopUpgrade: { level: 1 }, output: { grain: 7 } });
  const actor = { uid: 1, building: 7, job: "Farmer", phase: "outputPutdown",
    x: 10, z: 10, visible: false, ware: "grain", path: [],
    wareTransfer: { progress: .99 } } as unknown as SettlementActor;
  const produced: string[] = [];
  const context = { buildings: [building], actors: [actor],
    options: { onProduced: (ware: string) => produced.push(ware) }
  } as unknown as SettlementContext;
  updateWorker(context, actor, .1);
  expect(building.output.grain).toBe(8);
  expect(produced).toEqual(["grain"]);
  expect(actor.ware).toBeNull(); expect(actor.phase).toBe("rest");
});


describe("pooled storage integration", () => {
  it("clips a real output cart reservation to the remaining per-ware island capacity", () => {
    const { advance, building, simulation } = fixture(33, true);
    simulation.headquarters.inventory.iron = 998;
    building.output = { iron: 8 };
    advance(1);
    const incoming = simulation.headquarters.incoming.iron ?? 0;
    expect(incoming).toBeGreaterThan(0);
    expect(incoming).toBeLessThanOrEqual(2);
    const trip = simulation.frames().find(actor => actor.handcart?.trip?.ware === "iron")?.handcart?.trip;
    expect(trip?.planned).toBe(2);
    const state = simulation.saveState();
    expect(simulation.loadState(state).ok).toBe(true);
    expect(simulation.headquarters.incoming.iron).toBe(incoming);
  });
  it("upgrades HQ through its real own-storage escrow and builder path", () => {
    const { advance, simulation } = fixture();
    const hq = simulation.headquarters;
    expect(simulation.requestWorkshopUpgrade(hq.uid)).toBe(true);
    expect(hq.workshopUpgrade?.reserved).toEqual({ hardwoodPlanks: 4, marble: 2 });
    const pending = simulation.saveState();
    expect(simulation.loadState(pending).ok).toBe(true);
    expect(simulation.headquarters.workshopUpgrade?.reserved).toEqual({ hardwoodPlanks: 4, marble: 2 });
    expect(hq.inventory.hardwoodPlanks ?? 0).toBe(0);
    advance(180, () => hq.workshopUpgrade?.level === 1);
    expect(hq.workshopUpgrade?.level).toBe(1);
    const upgraded = simulation.saveState();
    expect(simulation.loadState(upgraded).ok).toBe(true);
    expect(simulation.headquarters.workshopUpgrade?.level).toBe(1);
  });
});

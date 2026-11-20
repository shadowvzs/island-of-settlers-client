import { describe, expect, it } from "vitest";

import { assignGarrisonSlots, type GarrisonSlot } from "../src/render-common/buildings/military-garrison-slots";
import { CATAPULT_HOME_YAW, catapultCrewLocalPose, type CatapultPhase } from "../src/shared/settlement/catapult-cycle";
import { fireCatapultTowers } from "../src/shared/settlement/military-catapult";
import { isValidComposition, nextGarrisonTroop, surplusGarrisonTroop } from "../src/shared/settlement/military-garrison-rules";
import type { MilitaryArrow } from "../src/shared/settlement/military-projectiles";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

interface SavedFixture {
  building: SettlementBuilding;
  enemies: SettlementActor[];
  shots: Omit<MilitaryArrow, "id">[];
  soldiers: [number, SettlementSoldier][];
}
const heavy = (actor = 2): SettlementSoldier => ({ actor, building: 1, rank: 0, stationed: true,
  combat: { type: "heavy", faction: 0, hp: 100, cooldown: 0 } });
const createFixture = (saved?: SavedFixture) => {
  const initial: SavedFixture = saved ?? {
    building: { uid: 1, typeId: 16, x: 4, y: 0, z: 4, width: 2, depth: 2, rotation: 0,
      construction: 1, input: { stone: 6 }, incoming: {} } as unknown as SettlementBuilding,
    enemies: [{ uid: 3, x: 8, y: 0, z: 4, visible: true, phase: "militaryField" } as SettlementActor],
    shots: [], soldiers: [[2, heavy()], [3, { ...heavy(3), building: -3, stationed: false,
      combat: { ...heavy().combat!, faction: 1 } }]]
  };
  const { building, enemies, shots } = initial;
  const soldiers = new Map(initial.soldiers);
  const context = { buildings: [building], options: { world: {
    cellsX: 16, cellsZ: 16, heights: new Float32Array(17 * 17)
  } } } as SettlementContext;
  const update = () => fireCatapultTowers(context, soldiers, enemies, .05, shot => shots.push(shot));
  const advance = (seconds: number) => {
    for (let tick = 0; tick < Math.round(seconds * 20); tick++) update();
  };
  const snapshot = (): SavedFixture => JSON.parse(JSON.stringify({ building, enemies, shots,
    soldiers: [...soldiers] }));
  return { advance, building, context, enemies, shots, snapshot, soldiers, update };
};

describe("Catapult action replay and crew transitions", () => {
  it("aims from the rooftop operator above a low ridge and still respects a ridge above the sight line", () => {
    for (const height of [1.7, 3]) {
      const live = createFixture();
      const world = live.context.options.world;
      for (let z = 0; z <= world.cellsZ; z++) world.heights[z * (world.cellsX + 1) + 6] = height;
      live.advance(16);
      expect(live.shots.length > 0).toBe(height < 2);
    }
  });

  it.each(["pick", "load", "clear", "traverse", "fire", "return", "park"] as CatapultPhase[])(
    "continues identically after a JSON boundary during %s", phase => {
      const live = createFixture();
      for (let tick = 0; tick < 800; tick++) {
        live.update();
        if (live.building.catapultCycle?.phase === phase && live.building.catapultCycle.elapsed > .05) break;
      }
      expect(live.building.catapultCycle?.phase).toBe(phase);
      const restored = createFixture(live.snapshot());
      live.advance(30); restored.advance(30);
      expect(restored.snapshot()).toEqual(live.snapshot());
      expect(live.shots.length).toBeGreaterThanOrEqual(2);
      expect(live.building.input.stone).toBe(6 - live.shots.length);
    }
  );

  it("finishes a living operator's physical load when the target leaves, then retains the cup through replacement and JSON", () => {
    const live = createFixture(); live.advance(2);
    expect(live.building.catapultCycle?.ammo).toBe("hand");
    live.enemies.length = 0; live.advance(20);
    expect(live.building.catapultCycle).toMatchObject({ ammo: "cup", phase: "ready" });
    expect(live.building.input.stone).toBe(6); expect(live.shots).toHaveLength(0);
    live.soldiers.delete(2); live.soldiers.set(4, heavy(4));
    live.enemies.push({ uid: 3, x: 8, y: 0, z: 4, visible: true, phase: "militaryField" } as SettlementActor);
    const restored = createFixture(live.snapshot());
    live.advance(30); restored.advance(30);
    expect(live.shots.length).toBeGreaterThan(0);
    expect(live.building.input.stone).toBe(6 - live.shots.length);
    expect(restored.snapshot()).toEqual(live.snapshot());
  });

  it.each(["death", "defence"])("keeps the exact dropped hand stone after %s until a real replacement retrieves it", reason => {
    const live = createFixture(); live.advance(2.1);
    const before = live.building.catapultCycle!;
    const point = catapultCrewLocalPose(before, CATAPULT_HOME_YAW, 16 / 11, 6).carryPoint;
    if (reason === "death") live.soldiers.delete(2); else live.enemies[0]!.x = 5.2;
    live.update();
    expect(live.building.catapultCycle).toMatchObject({ ammo: "loose", phase: "loose", ammoPoint: point });
    expect(live.building.input.stone).toBe(6); expect(live.shots).toHaveLength(0);
    const restored = createFixture(live.snapshot());
    if (reason === "death") { live.soldiers.set(4, heavy(4)); restored.soldiers.set(4, heavy(4)); }
    else { live.enemies[0]!.x = 8; restored.enemies[0]!.x = 8; }
    let retrieved = false;
    for (let tick = 0; tick < 1200 && !live.shots.length; tick++) {
      live.update(); restored.update();
      retrieved ||= live.building.catapultCycle?.phase === "retrieve";
    }
    expect(retrieved).toBe(true); expect(live.shots).toHaveLength(1);
    expect(live.building.input.stone).toBe(5);
    expect(restored.snapshot()).toEqual(live.snapshot());
  });

  it("keeps a partially released cup through target loss, rewinds and parks it without a debit", () => {
    const live = createFixture();
    for (let tick = 0; tick < 800 && !(live.building.catapultCycle?.phase === "fire" && live.building.catapultCycle.elapsed >= .1); tick++) live.update();
    live.enemies.length = 0; live.update();
    expect(live.building.catapultCycle?.ammo).toBe("cup");
    const restored = createFixture(live.snapshot());
    live.advance(20); restored.advance(20);
    expect(live.building.catapultCycle).toMatchObject({ ammo: "cup", phase: "ready", armHold: 1.25 });
    expect(live.building.catapultAim).toBeCloseTo(CATAPULT_HOME_YAW);
    expect(live.building.input.stone).toBe(6); expect(live.shots).toHaveLength(0);
    expect(restored.snapshot()).toEqual(live.snapshot());
  });

  it("preserves the building reload when a new heavy replaces the operator after launch", () => {
    const live = createFixture();
    for (let tick = 0; tick < 800 && !live.shots.length; tick++) live.update();
    expect(live.shots).toHaveLength(1);
    live.soldiers.delete(2); live.soldiers.set(4, heavy(4));
    const restored = createFixture(live.snapshot());
    live.advance(4.9); restored.advance(4.9);
    expect(live.shots).toHaveLength(1);
    for (let tick = 0; tick < 800 && live.shots.length < 2; tick++) { live.update(); restored.update(); }
    expect(live.shots).toHaveLength(2);
    expect(restored.snapshot()).toEqual(live.snapshot());
  });

  it("replaces an automatic shield with a newly available heavy and respects valid manual counts", () => {
    const full = { archer: 0, heavy: 0, shield: 3 };
    expect(surplusGarrisonTroop(16, full, undefined, type => type === "heavy")).toBe("shield");
    expect(nextGarrisonTroop(16, { ...full, shield: 2 }, undefined, () => true)).toBe("heavy");
    expect(isValidComposition(16, full)).toBe(false);
    expect(isValidComposition(16, { archer: 0, heavy: 0, shield: 0 })).toBe(true);
    expect(isValidComposition(16, { archer: 0, heavy: 1, shield: 2 })).toBe(true);
    const manual = { archer: 0, heavy: 1, shield: 1 };
    expect(nextGarrisonTroop(16, manual, manual, () => true)).toBeNull();
    expect(surplusGarrisonTroop(16, manual, manual, () => true)).toBeNull();
  });

  it("reserves the rooftop operating position for a heavy", () => {
    const slots: GarrisonSlot[] = [
      { kind: "crew", lean: 0, position: [0, 2, 0], yaw: 0 },
      { kind: "window", lean: .6, position: [-1, 1, 0], yaw: 0 },
      { kind: "window", lean: .6, position: [1, 1, 0], yaw: 0 }
    ];
    const shield = { combat: { type: "shield" } };
    expect(assignGarrisonSlots(slots, [shield, shield]).every(entry => entry.slot.kind === "window")).toBe(true);
    const operator = { combat: { type: "heavy" } };
    expect(assignGarrisonSlots(slots, [shield, operator])[0]).toMatchObject({ slot: { kind: "crew" }, soldier: operator });
  });
});

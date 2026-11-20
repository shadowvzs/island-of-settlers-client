import { describe, expect, it } from "vitest";

import {
  catapultAmmoAllowsRestock, catapultAmmoError, catapultAmmoRecovery, type CatapultAmmoReservation, type CatapultAmmoSite,
  catapultNextRackSlot, catapultOutgoingStone, catapultPickupSlot, catapultRackCount, catapultRackSlots,
  catapultReservedAmmo, dropReservedStone, landReservedStone, loadReservedStone, releaseReservedStone,
  reserveRackStone, retrieveReservedStone, withdrawCatapultRoofStone
} from "../src/shared/settlement/military-catapult-ammo";

const fixture = (roof = 5) => ({ catapultCycle: { phase: "pick" } as CatapultAmmoReservation,
  input: { stone: roof } });
const cup = (roof = 5) => {
  const site = fixture(roof); reserveRackStone(site); loadReservedStone(site);
  return site;
};
const ready = (site: ReturnType<typeof fixture>) => {
  site.catapultCycle.phase = "ready"; site.catapultCycle.armHold = 1.25;
};

describe("Finite reserved Catapult roof ammunition", () => {
  it("reserves exactly one real rack stone at pickup and debits it only at projectile release", () => {
    const site = fixture(2);
    expect(catapultRackSlots(site)).toEqual([0, 1]);
    expect(reserveRackStone(site)).toBe(true); expect(reserveRackStone(site)).toBe(false);
    expect(site.input.stone).toBe(2); expect(site.catapultCycle.ammo).toBe("hand");
    expect(site.catapultCycle.stoneSlot).toBe(1); expect(catapultReservedAmmo(site)).toBe(1);
    expect(catapultRackSlots(site)).toEqual([0]);
    expect(releaseReservedStone(site)).toBe(false); expect(site.input.stone).toBe(2);
    expect(loadReservedStone(site)).toBe(true); expect(loadReservedStone(site)).toBe(false);
    expect(site.input.stone).toBe(2);
    expect(releaseReservedStone(site)).toBe(true); expect(releaseReservedStone(site)).toBe(false);
    expect(site.input.stone).toBe(1); expect(catapultReservedAmmo(site)).toBe(0);
    expect(catapultRackSlots(site)).toEqual([0]);
  });

  it("refills the first vacant visible slot without hiding the new stone at the historical pickup index", () => {
    const site = fixture(1); reserveRackStone(site); loadReservedStone(site); ready(site);
    expect(site.catapultCycle.stoneSlot).toBe(0);
    expect(catapultRackSlots(site)).toEqual([]); expect(catapultNextRackSlot(site)).toBe(0);
    site.input.stone++; // A real porter has completed its one-stone roof putdown.
    expect(catapultRackSlots(site)).toEqual([0]);
    expect(site.catapultCycle.stoneSlot).toBe(0); expect(catapultNextRackSlot(site)).toBeUndefined();
    expect(site.input.stone).toBe(2); expect(catapultAmmoError(site.catapultCycle, 2)).toBeUndefined();
    expect(catapultReservedAmmo(site) + catapultRackCount(site)).toBe(2);
  });

  it.each(["pick", "load"])("finishes a living operator's hand-carried %s after target death into a latched cup", phase => {
    const site = fixture(); reserveRackStone(site); site.catapultCycle.phase = phase;
    const before = structuredClone(site);
    expect(catapultAmmoRecovery(site, "target-lost")).toBe("finish-load");
    expect(site).toEqual(before); expect(site.catapultCycle.ammo).toBe("hand");
    loadReservedStone(site); ready(site);
    expect(site.input.stone).toBe(5); expect(catapultRackCount(site)).toBe(4);
    expect(catapultAmmoError(site.catapultCycle, 5)).toBeUndefined();
  });

  it.each(["wind", "clear", "traverse", "fire"])(
    "keeps the physical cup stone after target/operator loss or defence during %s", phase => {
      for (const reason of ["target-lost", "operator-lost", "defence"] as const) {
        const site = cup(); site.catapultCycle.phase = phase; site.catapultCycle.armHold = .7;
        const before = structuredClone(site);
        expect(catapultAmmoRecovery(site, reason)).toBe("hold-cup");
        expect(site).toEqual(before); expect(site.input.stone).toBe(5);
        expect(dropReservedStone(site, [-.3, 2.1, .4], 1.825)).toBe(false);
        site.catapultCycle.phase = "ready";
        expect(site.catapultCycle.ammo).toBe("cup"); expect(site.catapultCycle.armHold).toBe(.7);
        expect(catapultAmmoError(site.catapultCycle, 5)).toBeUndefined();
      }
    }
  );

  it.each(["operator-lost", "defence"] as const)(
    "retains a real dropped hand stone at its saved roof point after %s", reason => {
      const site = fixture(); reserveRackStone(site); site.catapultCycle.phase = "load";
      expect(catapultAmmoRecovery(site, reason)).toBe("drop");
      const point: [number, number, number] = [-.53, 2.14, .31];
      expect(dropReservedStone(site, point, 1.825)).toBe(true); site.catapultCycle.phase = "loose";
      point[0] = 99;
      expect(site.catapultCycle.ammoPoint).toEqual([-.53, 2.14, .31]);
      expect(site.input.stone).toBe(5); expect(catapultRackCount(site)).toBe(4);
      expect(catapultAmmoRecovery(site, "operator-lost")).toBe("await-retrieval");
      expect(reserveRackStone(site)).toBe(false); expect(dropReservedStone(site, [0, 2, 0], 1.825)).toBe(false);
      expect(catapultAmmoError(site.catapultCycle, 5)).toBeUndefined();
    }
  );

  it.each(["hand", "cup", "loose"] as const)("manual withdrawal cannot take the reserved %s unit", owner => {
    const site = fixture(); reserveRackStone(site);
    if (owner === "cup") { loadReservedStone(site); ready(site); }
    if (owner === "loose") { dropReservedStone(site, [-.53, 2.14, .31], 1.825); site.catapultCycle.phase = "loose"; }
    expect(catapultOutgoingStone(site)).toBe(4);
    expect(withdrawCatapultRoofStone(site, 99)).toBe(4); expect(withdrawCatapultRoofStone(site, 1)).toBe(0);
    expect(site.input.stone).toBe(1); expect(site.catapultCycle.ammo).toBe(owner);
    expect(catapultRackSlots(site)).toEqual([]); expect(catapultReservedAmmo(site)).toBe(1);
    expect(catapultAmmoError(site.catapultCycle, 1)).toBeUndefined();
  });

  it("replays ready, falling and replacement-pickup boundaries without duplicating ammo or moving it to the rack", () => {
    const site = fixture(); reserveRackStone(site);
    dropReservedStone(site, [-.53, 2.14, .31], 1.825, .2); site.catapultCycle.phase = "loose";
    const restored = JSON.parse(JSON.stringify(site)) as ReturnType<typeof fixture>;
    expect(catapultAmmoError(restored.catapultCycle, restored.input.stone)).toBeUndefined();
    for (const current of [site, restored]) {
      current.catapultCycle.phase = "retrieve";
      current.catapultCycle.recoveryPath = [[-.2, 1.77, .5], [-.53, 1.77, .31]];
      current.catapultCycle.recoverySeconds = 1.4;
      expect(catapultAmmoError(current.catapultCycle, current.input.stone)).toBeUndefined();
      expect(retrieveReservedStone(current)).toBe(true); expect(retrieveReservedStone(current)).toBe(false);
      current.catapultCycle.phase = "load";
      current.catapultCycle.loadPath = [[-.53, 1.77, .31], [.2, 1.77, .5]];
      current.catapultCycle.loadSeconds = 2;
      expect(current.catapultCycle.ammoPoint).toBeUndefined();
      loadReservedStone(current); ready(current);
    }
    expect(restored).toEqual(site);
    const waiting = JSON.parse(JSON.stringify(site)) as ReturnType<typeof fixture>;
    expect(catapultAmmoError(waiting.catapultCycle, waiting.input.stone)).toBeUndefined();
    for (const current of [site, waiting]) {
      expect(catapultAmmoRecovery(current, "target-lost")).toBe("hold-cup");
      current.catapultCycle.phase = "recover-cup";
      expect(catapultAmmoError(current.catapultCycle, current.input.stone)).toBeUndefined();
      current.catapultCycle.phase = "traverse";
      expect(releaseReservedStone(current)).toBe(true); current.catapultCycle.phase = "return";
    }
    expect(waiting).toEqual(site); expect(site.input.stone).toBe(4);
  });

  it("transfers roof custody only at actual off-roof ground landing, atomically and once", () => {
    const site = fixture(); reserveRackStone(site);
    dropReservedStone(site, [.9, 2.14, .31], .055); site.catapultCycle.phase = "loose";
    let ground = 0;
    const before = structuredClone(site), landing = [.9, .055, .31] as const;
    expect(landReservedStone(site, landing, () => false)).toBe(false); expect(site).toEqual(before);
    expect(landReservedStone(site, landing, actual => {
      expect(actual).toEqual(landing); expect(site.input.stone).toBe(4);
      expect(catapultReservedAmmo(site)).toBe(0); ground++; return true;
    })).toBe(true);
    expect(landReservedStone(site, landing, () => { ground++; return true; })).toBe(false);
    expect(ground).toBe(1); expect(site.input.stone + ground).toBe(5);
  });

  it("allows peaceful restocking around a home-parked latched ready cup without exposing that stone on the rack", () => {
    const site = cup(); ready(site);
    expect(catapultAmmoAllowsRestock(site, true)).toBe(true);
    expect(catapultAmmoAllowsRestock(site, false)).toBe(false);
    site.catapultCycle.armHold = .6;
    expect(catapultAmmoAllowsRestock(site, true)).toBe(false);
    site.catapultCycle.armHold = 1.25; site.catapultCycle.phase = "rewind";
    expect(catapultAmmoAllowsRestock(site, true)).toBe(false);
    ready(site); withdrawCatapultRoofStone(site, 4);
    expect(site.input.stone).toBe(1); expect(catapultNextRackSlot(site)).toBe(0);
    expect(catapultAmmoAllowsRestock(site, true)).toBe(true);
    site.input.stone++; // A completed peaceful porter trip fills the empty rack, not the held cup.
    expect(catapultRackSlots(site)).toEqual([0]); expect(catapultReservedAmmo(site)).toBe(1);
    expect(catapultAmmoAllowsRestock(site, true)).toBe(true);
    expect(catapultAmmoAllowsRestock({ input: { stone: 0 } }, true)).toBe(true);
  });

  it("rejects phantom reservations, malformed local points and invalid recovery states", () => {
    const invalid: { cycle: CatapultAmmoReservation; roof: number }[] = [
      { cycle: { ammo: "cup", phase: "ready" }, roof: 0 },
      { cycle: { phase: "ready" }, roof: 1 },
      { cycle: { ammo: "hand", phase: "rewind" }, roof: 1 },
      { cycle: { ammo: "loose", phase: "loose" }, roof: 1 },
      { cycle: { ammo: "loose", phase: "wind", ammoPoint: [0, 2, 0], ammoFloor: 1.825, ammoElapsed: 0 }, roof: 1 },
      { cycle: { ammo: "cup", phase: "ready", ammoPoint: [0, NaN, 0] }, roof: 1 },
      { cycle: { ammo: "cup", phase: "ready", armHold: 1.26 }, roof: 1 },
      { cycle: { ammo: "cup", phase: "ready", recoveryPath: [[0, Infinity, 0]] }, roof: 1 },
      { cycle: { ammo: "cup", phase: "ready", recoverySeconds: -1 }, roof: 1 },
      { cycle: { phase: "unknown" }, roof: 1 }
    ];
    for (const value of invalid) expect(catapultAmmoError(value.cycle, value.roof)).toBeTypeOf("string");
    expect(catapultAmmoError(undefined, 6)).toBeUndefined();
    expect(catapultAmmoError({ phase: "load", stoneSlot: 5 }, 3)).toBeUndefined();
    expect(reserveRackStone({ input: { stone: 0 }, catapultCycle: {} })).toBe(false);
    expect(catapultNextRackSlot({ input: { stone: 6 } })).toBeUndefined();
    expect(catapultPickupSlot({ input: { stone: 0 } })).toBeUndefined();
    expect(withdrawCatapultRoofStone({ input: { stone: 1 } } as CatapultAmmoSite, .5)).toBe(0);
  });
});

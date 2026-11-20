import { describe, expect, it } from "vitest";

import {
  advanceCatapultResupply, CATAPULT_SUPPLY_SECONDS, catapultGroundStone, catapultLocalStone, catapultPorterReferencesError,
  catapultRoofReserved,
  catapultStoneDemand,
  type CatapultSupply, type CatapultSupplyActions, catapultSupplyError, chooseCatapultPorter,
  depositCatapultGroundStone, detachCatapultPorter, dropCatapultStone, normalizeCatapultRoofStock
} from "../src/shared/settlement/military-catapult-resupply";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

const fixture = () => {
  const site = { uid: 1, catapultSupply: { ground: 3 } as CatapultSupply,
    input: { stone: 0 }, incoming: { stone: 0 } };
  const phases: string[] = [], recovered: boolean[] = [];
  let available = true, arrived = true, threatened = false;
  const actions: CatapultSupplyActions = {
    choosePorter: () => available ? 2 : undefined,
    enterPhase: porter => { phases.push(porter.phase); },
    finish: porter => { recovered.push(porter.carrying); },
    isAvailable: () => available,
    walk: () => arrived
  };
  const step = (dt = .05) => advanceCatapultResupply(site, dt, threatened, actions);
  const throughPickup = () => {
    step(); step(); step(CATAPULT_SUPPLY_SECONDS.pickup);
  };
  const complete = () => {
    step(); step(CATAPULT_SUPPLY_SECONDS["stairs-up"]); step();
    step(CATAPULT_SUPPLY_SECONDS.place); step(); step(CATAPULT_SUPPLY_SECONDS["stairs-down"]);
  };
  return { actions, complete, phases, recovered, site, step, throughPickup,
    setAvailable: (value: boolean) => { available = value; },
    setArrived: (value: boolean) => { arrived = value; },
    setThreatened: (value: boolean) => { threatened = value; } };
};

describe("Catapult realistic resupply ownership", () => {
  it("fills two roof stones then resumes one physical trip after each shot or new ground delivery", () => {
    const { complete, site, step, throughPickup } = fixture();
    throughPickup(); complete();
    throughPickup(); complete();
    expect(site.input.stone).toBe(2);
    expect(site.catapultSupply.ground).toBe(1);
    for (let tick = 0; tick < 20; tick++) step();
    expect(site.catapultSupply.porter).toBeUndefined();
    site.input.stone--; // Actual projectile release frees one upstairs place.
    throughPickup(); complete();
    expect(site.input.stone).toBe(2);
    expect(site.catapultSupply.ground).toBe(0);
    site.input.stone--; step();
    expect(site.catapultSupply.porter).toBeUndefined();
    expect(depositCatapultGroundStone(site, 2)).toBe(2);
    throughPickup(); complete(); step();
    expect(site.input.stone).toBe(2);
    expect(site.catapultSupply.ground).toBe(1);
    expect(site.catapultSupply.porter).toBeUndefined();
  });

  it("moves old six-stone roof stocks downstairs without losing reserved or carried ammunition", () => {
    const { site } = fixture();
    site.input.stone = 6; site.catapultSupply.ground = 0;
    normalizeCatapultRoofStock(site);
    expect(site.input.stone).toBe(2); expect(site.catapultSupply.ground).toBe(4);
    normalizeCatapultRoofStock(site);
    expect(catapultLocalStone(site)).toBe(6);
    site.catapultSupply.ground--;
    site.catapultSupply.porter = { actor: 2, carrying: true, elapsed: 0, phase: "stairs-up" };
    normalizeCatapultRoofStock(site);
    expect(site.input.stone).toBe(1); expect(site.catapultSupply.ground).toBe(4);
    expect(catapultLocalStone(site)).toBe(6);
  });

  it("delivers to the finite ground pile and requests space across every ammunition owner", () => {
    const { site } = fixture();
    site.input.stone = 1; site.incoming.stone = 1;
    expect(catapultLocalStone(site)).toBe(4); expect(catapultStoneDemand(site)).toBe(1);
    expect(depositCatapultGroundStone(site, 1)).toBe(1);
    expect(site.input.stone).toBe(1); expect(site.catapultSupply.ground).toBe(4);
    expect(catapultStoneDemand(site)).toBe(0);
    site.incoming.stone = 0;
    expect(depositCatapultGroundStone(site, 4)).toBe(1);
    expect(depositCatapultGroundStone(site, 1)).toBe(0);
    expect(depositCatapultGroundStone(site, -.5)).toBe(0);
  });

  it("moves one real stone through hands and stairs before adding roof ammunition", () => {
    const { complete, phases, site, step, throughPickup } = fixture();
    throughPickup();
    expect(site.catapultSupply.ground).toBe(2); expect(site.input.stone).toBe(0);
    expect(site.catapultSupply.porter?.carrying).toBe(true); expect(catapultLocalStone(site)).toBe(3);
    complete();
    expect(site.input.stone).toBe(1); expect(catapultLocalStone(site)).toBe(3);
    expect(site.catapultSupply.porter).toBeUndefined();
    expect(phases).toEqual(["outbound", "pickup", "inbound", "stairs-up", "roof", "place",
      "roof-return", "stairs-down"]);
    step(); expect(site.catapultSupply.porter?.phase).toBe("outbound");
  });

  it("cannot use timers to skip blocked outdoor or rooftop movement", () => {
    const { setArrived, site, step } = fixture();
    step(); setArrived(false); step(1000);
    expect(site.catapultSupply.porter?.phase).toBe("outbound");
    expect(site.catapultSupply.ground).toBe(3); expect(site.input.stone).toBe(0);
    setArrived(true); step(); step(.6); step(); step(CATAPULT_SUPPLY_SECONDS["stairs-up"]);
    expect(site.catapultSupply.porter?.phase).toBe("roof");
    setArrived(false); step(1000);
    expect(site.input.stone).toBe(0); expect(site.catapultSupply.porter?.carrying).toBe(true);
  });

  it("stops collecting as soon as threatened, including immediately before pickup completion", () => {
    const { recovered, setThreatened, site, step } = fixture();
    step(); step(); step(.59); setThreatened(true); step(.05);
    expect(site.catapultSupply.porter?.phase).toBe("inbound");
    expect(site.catapultSupply.ground).toBe(3); step();
    expect(site.catapultSupply.porter).toBeUndefined(); expect(recovered).toEqual([false]);
    step(100); expect(site.catapultSupply.porter).toBeUndefined();
  });

  it("retains a carried stone during retreat and completes only its existing trip", () => {
    const { complete, setThreatened, site, step, throughPickup } = fixture();
    throughPickup(); setThreatened(true);
    complete(); step(10);
    expect(site.input.stone).toBe(1); expect(site.catapultSupply.ground).toBe(2);
    expect(site.catapultSupply.porter).toBeUndefined(); expect(catapultLocalStone(site)).toBe(3);
  });

  it("reserves the roof and holds the loaded porter hidden until the heavy parks clear", () => {
    const { actions, site, step, throughPickup } = fixture();
    actions.roofSafe = () => false;
    throughPickup(); step();
    expect(catapultRoofReserved(site)).toBe(true);
    step(100); expect(site.catapultSupply.porter?.phase).toBe("stairs-up");
    expect(site.catapultSupply.porter?.elapsed).toBe(0); expect(site.input.stone).toBe(0);
    actions.roofSafe = () => true;
    step(CATAPULT_SUPPLY_SECONDS["stairs-up"]); step(); step(.6); step();
    expect(site.catapultSupply.porter?.phase).toBe("stairs-down"); expect(catapultRoofReserved(site)).toBe(true);
    step(CATAPULT_SUPPLY_SECONDS["stairs-down"] * .5); expect(catapultRoofReserved(site)).toBe(true);
    step(CATAPULT_SUPPLY_SECONDS["stairs-down"] * .1); expect(catapultRoofReserved(site)).toBe(false);
  });

  it("replays every saved phase without duplicate pickups or roof deposits", () => {
    const original = fixture();
    const steps = [.05, .05, .6, .05, CATAPULT_SUPPLY_SECONDS["stairs-up"], .05, .6, .05,
      CATAPULT_SUPPLY_SECONDS["stairs-down"]];
    for (let index = 0; index < steps.length; index++) {
      original.step(steps[index]);
      const saved = structuredClone(original.site), restored = structuredClone(saved);
      const actions = { ...original.actions, enterPhase: () => {}, finish: () => {} };
      expect(catapultSupplyError(saved.catapultSupply, saved.input.stone, saved.incoming.stone)).toBeUndefined();
      for (const dt of steps.slice(index + 1)) {
        advanceCatapultResupply(saved, dt, false, actions);
        advanceCatapultResupply(restored, dt, false, actions);
        expect(restored).toEqual(saved); expect(catapultLocalStone(restored)).toBe(3);
      }
    }
  });

  it("hands casualty cargo to recovery exactly once and never teleports it into either stock", () => {
    const { recovered, setAvailable, site, step, throughPickup } = fixture();
    throughPickup(); setAvailable(false); step(); step();
    expect(recovered).toEqual([true]); expect(site.catapultSupply.ground).toBe(2);
    expect(site.input.stone).toBe(0); expect(detachCatapultPorter(site)).toBeUndefined();
  });

  it("keeps casualty stone at its saved drop until the next real porter completes pickup there", () => {
    const { site, step } = fixture();
    site.catapultSupply.ground = 4; site.input.stone = 1;
    site.catapultSupply.porter = { actor: 2, carrying: true, elapsed: 0, phase: "inbound" };
    const casualty = detachCatapultPorter(site)!;
    expect(casualty.carrying).toBe(true);
    const drop = { x: 3.5, y: .2, z: 4.5 };
    expect(dropCatapultStone(site, drop)).toBe(true);
    expect(site.catapultSupply.ground).toBe(4); expect(catapultGroundStone(site)).toBe(5);
    expect(catapultLocalStone(site)).toBe(6); expect(catapultStoneDemand(site)).toBe(0);
    step(); expect(site.catapultSupply.porter?.drop).toBe(0);
    expect(catapultSupplyError(site.catapultSupply, 1, 0)).toBeUndefined();
    step(); step(.59); expect(site.catapultSupply.drops).toEqual([drop]);
    step(.01); expect(site.catapultSupply.drops).toEqual([]);
    expect(site.catapultSupply.porter?.carrying).toBe(true); expect(site.catapultSupply.porter?.drop).toBeUndefined();
    expect(catapultLocalStone(site)).toBe(6); expect(site.input.stone).toBe(1);
  });

  it("chooses only the admitted full-time civilian worker, never a guard or unrelated Carrier", () => {
    const site = { uid: 1, worker: 3, input: {}, incoming: {} };
    const actor = (uid: number) => ({ uid, building: 1, job: "Carrier", phase: "inside", visible: false,
      ware: null } as SettlementActor);
    expect(chooseCatapultPorter(site, actor)).toBe(3);
    expect(chooseCatapultPorter({ ...site, worker: undefined }, actor)).toBeUndefined();
    expect(chooseCatapultPorter(site, uid => ({ ...actor(uid), job: "Soldier" }))).toBeUndefined();
    expect(chooseCatapultPorter(site, uid => ({ ...actor(uid), visible: true }))).toBeUndefined();
    expect(chooseCatapultPorter(site, uid => ({ ...actor(uid), phase: "assigned" }))).toBeUndefined();
    expect(chooseCatapultPorter(site, uid => ({ ...actor(uid), building: 2 }))).toBeUndefined();
  });

  it("rejects duplicated cargo, bad timers and over-capacity save states", () => {
    expect(catapultSupplyError(undefined, 6, 0)).toBeUndefined();
    expect(catapultSupplyError({ ground: 1 }, 5, 1)).toMatch(/capacity/);
    const porter = { actor: 2, carrying: true, elapsed: 0, phase: "outbound" };
    expect(catapultSupplyError({ ground: 0, porter }, 0, 0)).toMatch(/cargo/);
    expect(catapultSupplyError({ ground: 0, porter: { ...porter, phase: "place", elapsed: 10 } }, 0, 0))
      .toMatch(/timer/);
    expect(catapultSupplyError({ ground: -1 }, 0, 0)).toMatch(/stock/);
    expect(catapultSupplyError({ ground: 0, porter: { ...porter, phase: "stairs-up" } }, 5, 0))
      .toBeUndefined();
  });

  it("validates the employed Carrier identity, civilian exterior phases and exact cargo", () => {
    const site = { uid: 1, worker: 2, input: {}, incoming: {}, catapultSupply: { ground: 0,
      porter: { actor: 2, carrying: true, elapsed: 0, phase: "inbound" as const } } };
    const actor = { uid: 2, building: 1, job: "Carrier", phase: "inputReturn", visible: true,
      ware: "stone" } as SettlementActor;
    expect(catapultPorterReferencesError(site, actor)).toBeUndefined();
    expect(catapultPorterReferencesError({ ...site, worker: 3 }, actor)).toMatch(/identity/);
    expect(catapultPorterReferencesError(site, { ...actor, job: "Soldier" })).toMatch(/identity/);
    expect(catapultPorterReferencesError(site, { ...actor, visible: false })).toMatch(/location/);
    expect(catapultPorterReferencesError(site, { ...actor, wareUnits: 2 })).toMatch(/carried/);
    expect(catapultPorterReferencesError(site, undefined)).toMatch(/identity/);
    const climbing = { ...site, catapultSupply: { ground: 0, porter: { ...site.catapultSupply.porter,
      phase: "stairs-up" as const } } };
    expect(catapultPorterReferencesError(climbing,
      { ...actor, phase: "catapultResupply", visible: false })).toBeUndefined();
  });
});

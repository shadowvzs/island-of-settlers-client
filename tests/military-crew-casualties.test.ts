import { describe, expect, it, vi } from "vitest";

import { MILITARY_PROFILES } from "../src/shared/balance/military";
import { fleesRaiders, isHeldCrew, releaseCrew } from "../src/shared/settlement/military-civilian-crews";
import { civilianHeldInside } from "../src/shared/settlement/military-civilian-safety";
import { createCivilianTargets } from "../src/shared/settlement/military-civilian-targets";
import { dropNavalPerson, forgetSavedNavalPerson } from "../src/shared/settlement/naval-person-release";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

/**
 * MIL-CREWS (owner 2026-11-09): boat crews, voyage helpers on land and Catapult roof
 * porters are raid targets; each death releases what the crew owned. (Cart crews: military-cart-crews.)
 */
const SIZE = 40;
const world = () => ({ cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, heights: new Float32Array((SIZE + 1) ** 2) });

const body = (uid: number, x: number, z: number, extra: object = {}) => ({
  uid, x, y: 0, z, yaw: 0, visible: true, phase: "assigned", action: "idle", job: "Carrier",
  ware: null, path: [], pathIndex: 0, building: 0, home: 0, ...extra
}) as unknown as SettlementActor;

const soldierOf = (type: "archer" | "heavy"): SettlementSoldier => ({
  actor: 1, building: -3, rank: 0, stationed: false,
  combat: { type, faction: 1, hp: MILITARY_PROFILES[type].hp, cooldown: 0 }
});

/** One computer soldier at (20, 20) and the crew member `victim`; `strike` lets the soldier hunt once. */
const scene = (victim: SettlementActor, others: SettlementActor[] = [], buildings: unknown[] = [],
  type: "archer" | "heavy" = "heavy", naval?: SettlementContext["naval"]) => {
  const shooter = body(1, 20, 20, { job: "Soldier", phase: "militaryField" });
  const actors = [shooter, victim, ...others];
  const context = { actors, buildings, naval, playerNation: "roman", reservations: new Map(),
    options: { world: world() } } as unknown as SettlementContext;
  const soldiers = new Map([[1, soldierOf(type)]]);
  const deaths: number[] = [];
  const civilians = createCivilianTargets(context, id => actors.find(actor => actor.uid === id),
    uid => soldiers.has(uid), effect => deaths.push(effect.id));
  const state = soldiers.get(1)!.combat!;
  const routing = { backAway: vi.fn(() => 0), plan: vi.fn(), stand: vi.fn(), walk: vi.fn() };
  const strike = () => {
    state.cooldown = 0;
    civilians.update();
    return civilians.hunt(shooter, state, 0, { stance: "camp" }, .05, routing);
  };
  return { actors, civilians, context, deaths, state, strike };
};

describe("MIL-CREWS: crew casualties", () => {
  it("a killed Shipwright's finished workshop boat reaches its storage; its workplace hires again", () => {
    const store = { uid: 30, typeId: 0, construction: 1, inventory: {}, incoming: {} };
    const yard = { uid: 31, typeId: 36, construction: 1, worker: 2, working: true, inventory: {}, incoming: {} };
    const shipwright = body(2, 20.6, 20, { boatWork: -1, building: 31, home: 30, job: "Shipwright", ware: "boat" });
    const { deaths, strike } = scene(shipwright, [], [store, yard]);
    strike(); strike();
    expect(deaths).toEqual([2]);
    expect(store.inventory).toEqual({ boat: 1 });
    expect(yard.worker).toBeUndefined();
  });

  it("a voyage helper killed on its way to the harbour is forgotten by every voyage list", () => {
    const forgetPerson = vi.fn();
    const helper = body(2, 20.6, 20, { job: "Settler", navalOrder: 7, phase: "navalToHarbour" });
    const naval = { forgetPerson } as unknown as SettlementContext["naval"];
    const { deaths, strike } = scene(helper, [], [], "heavy", naval);
    strike(); strike();
    expect(deaths).toEqual([2]);
    expect(forgetPerson).toHaveBeenCalledWith(2);
    // On the pier or aboard the same helper is no target.
    const aboard = body(3, 20.6, 20, { navalOrder: 7, phase: "navalToShip" });
    expect(scene(aboard).strike()).toBe(false);
  });

  it("drops a lost person from ships, orders, preparations, expeditions and shipwright sites", () => {
    const ship = { cargoCount: 5, passengers: [2, 3] };
    expect(dropNavalPerson(ship, 2)).toBe(true);
    expect(ship).toEqual({ cargoCount: 4, passengers: [3] });
    expect(dropNavalPerson(ship, 9)).toBe(false);
    const naval = { active: [[2, {}], [4, {}]] as [number, unknown][],
      colonies: { expeditions: [{ crew: [2, 5], passengers: [] }] },
      fleet: { orders: [{ passengers: [2] }], ships: [{ cargoCount: 1, passengers: [2] }] },
      preparation: { preparations: [{ passengers: [6, 2] }] } };
    forgetSavedNavalPerson(naval, 2);
    expect(naval).toEqual({ active: [[4, {}]], colonies: { expeditions: [{ crew: [5], passengers: [] }] },
      fleet: { orders: [{ passengers: [] }], ships: [{ cargoCount: 0, passengers: [] }] },
      preparation: { preparations: [{ passengers: [6] }] } });
  });

  it("a roof porter is out of melee reach, falls to arrows, and its supply run ends", () => {
    const tower = { uid: 40, typeId: 16, construction: 1, worker: 2, working: false, inventory: {}, incoming: {},
      catapultSupply: { ground: 0, porter: { actor: 2, carrying: true, elapsed: 0, phase: "roof" } } };
    const porter = body(2, 20.6, 20, { building: 40, phase: "catapultResupply", y: 3 });
    expect(scene(porter, [], [tower]).strike()).toBe(false);
    const { civilians, deaths, state, strike } = scene(porter, [], [tower], "archer");
    porter.x = 24;
    expect(strike()).toBe(true);
    expect(state.pendingTarget).toBe(2);
    civilians.wound(2, "archer", 0);
    civilians.wound(2, "archer", 0);
    expect(deaths).toEqual([2]);
    expect(tower.catapultSupply.porter).toBeUndefined();
    expect(tower.worker).toBeUndefined();
  });

  it("crews flee and stay inside like other civilians; roof porters keep the tower's own rule", () => {
    expect(fleesRaiders(body(2, 0, 0, { handcart: {} }))).toBe(true);
    expect(fleesRaiders(body(2, 0, 0, { leadingHorse: 9 }))).toBe(true);
    expect(fleesRaiders(body(2, 0, 0, { boatWork: 0 }))).toBe(true);
    expect(fleesRaiders(body(2, 0, 0, { navalOrder: 1, phase: "navalToHarbour" }))).toBe(true);
    expect(fleesRaiders(body(2, 0, 0, { phase: "catapultResupply" }))).toBe(false);
    expect(fleesRaiders(body(2, 0, 0, { navalOrder: 1, phase: "navalAboard" }))).toBe(false);
    const door = { uid: 5 } as SettlementBuilding;
    const threatened = (held: boolean) => ({ civilianThreat: { doorThreatened: () => held } }) as unknown as
      SettlementContext;
    const cartCrew = body(2, 0, 0, { handcart: { state: "stored" }, visible: false });
    expect(isHeldCrew(cartCrew)).toBe(true);
    expect(civilianHeldInside(threatened(true), cartCrew, door)).toBe(true);
    expect(civilianHeldInside(threatened(false), cartCrew, door)).toBe(false);
    expect(civilianHeldInside(threatened(true), body(3, 0, 0, { navalOrder: 1, phase: "navalToShip" }), door))
      .toBe(true);
  });

  it("a puller that ran keeps the load on its parked cart; killed later, the load is lost with it", () => {
    const runner = body(2, 0, 0), other = body(3, 0, 0);
    const parked = { cargo: 3, id: 2, owner: 9, ware: "stone", x: 1, yaw: 0, z: 1 };
    const kept = { cargo: 2, id: 3, owner: 9, ware: "plank", x: 4, yaw: 0, z: 4 };
    const context = { abandonedHandcarts: [parked, kept], actors: [runner, other], buildings: [] } as unknown as
      SettlementContext;
    releaseCrew(context, runner, true);
    expect(parked).toMatchObject({ cargo: 3, ware: "stone" });
    releaseCrew(context, runner, false);
    expect(parked).toEqual({ id: 2, owner: 9, x: 1, yaw: 0, z: 1 });
    expect(kept).toMatchObject({ cargo: 2, ware: "plank" });
  });
});

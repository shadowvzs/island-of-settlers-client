import { describe, expect, it, vi } from "vitest";

import { CIVILIAN_HP, MILITARY_PROFILES } from "../src/shared/balance/military";
import { createMilitaryArchery } from "../src/shared/settlement/military-archery";
import {
  CIVILIAN_ARCHER_RANGE, createCivilianTargets, isAttackableCivilian
} from "../src/shared/settlement/military-civilian-targets";
import { createMilitarySpatialGrid } from "../src/shared/settlement/military-spatial-grid";
import type { CombatCore } from "../src/shared/settlement/settlement-combat-core";
import { createCombatTargeting } from "../src/shared/settlement/settlement-combat-targeting";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { scriptedRandom } from "../src/shared/settlement/simulation-random";

/**
 * MIL-ASSAULT (owner 2026-11-09): every player civilian outside a building is an enemy target with
 * 30 HP. Computer archers shoot civilians close to them (after every player soldier, never through
 * walls) and back away from one standing inside the bow's minimum range; melee soldiers strike.
 */
const SIZE = 40;

const world = () => ({
  cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, heights: new Float32Array((SIZE + 1) ** 2)
});

const contextOf = (actors: SettlementActor[], buildings: unknown[] = []) => ({
  actors, buildings, playerNation: "roman", reservations: new Map(), options: { world: world() }
}) as unknown as SettlementContext;

const soldierBody = (uid = 1, x = 20, z = 20) => ({
  uid, x, y: 0, z, yaw: 0, visible: true, phase: "militaryField", action: "idle", job: "Soldier",
  path: [], pathIndex: 0
}) as unknown as SettlementActor;

const civilianBody = (uid: number, x: number, z: number, extra: object = {}) => ({
  uid, x, y: 0, z, yaw: 0, visible: true, phase: "assigned", action: "idle", job: "Carrier",
  ware: null, path: [], pathIndex: 0, building: 0, home: 0, ...extra
}) as unknown as SettlementActor;

const soldierOf = (type: "archer" | "heavy", actor = 1, faction = 1): SettlementSoldier => ({
  actor, building: -3, rank: 0, stationed: false,
  combat: { type, faction, hp: MILITARY_PROFILES[type].hp, cooldown: 0 }
});

const fixture = (buildings: unknown[] = [], type: "archer" | "heavy" = "archer") => {
  const shooter = soldierBody();
  const civilian = civilianBody(2, 25, 20);
  const actors = [shooter, civilian];
  const soldiers = new Map([[1, soldierOf(type)]]);
  const context = contextOf(actors, buildings);
  const deaths: number[] = [];
  const actorById = (id: number) => actors.find(actor => actor.uid === id);
  const civilians = createCivilianTargets(context, actorById, uid => soldiers.has(uid),
    effect => deaths.push(effect.id));
  const archery = createMilitaryArchery(context, soldiers, scriptedRandom("military", () => .5),
    actorById, undefined, civilians);
  const routing = { backAway: vi.fn(() => .05), plan: vi.fn(), stand: vi.fn(), walk: vi.fn() };
  const hits = vi.fn();
  const tick = (ticks: number) => {
    for (let index = 0; index < ticks; index++) {
      civilians.update();
      archery.update(.05, [shooter], hits);
    }
  };
  const fire = () => archery.fireAtCivilian(soldiers.get(1)!, civilian, shooter);
  const state = soldiers.get(1)!.combat!;
  const hunt = () => civilians.hunt(shooter, state, 0, { stance: "camp" }, .05, routing);
  return { actors, archery, civilian, civilians, context, deaths, fire, hits, hunt, routing, shooter, soldiers,
    state, tick };
};

describe("MIL-ASSAULT: civilians outside buildings are enemy targets", () => {
  it("arms and looses a bow shot; two arrows kill a 30 HP civilian", () => {
    const { actors, archery, civilian, civilians, deaths, fire, hits, hunt, routing, state, tick } = fixture();
    expect(hunt()).toBe(true);
    expect(state.pendingTarget).toBe(civilian.uid);
    expect(state.attackTime).toBe(.6);
    expect(routing.stand).toHaveBeenCalled();
    fire();
    expect(archery.arrows()).toHaveLength(1);
    tick(60);
    expect(civilians.hitPoints(civilian.uid)).toBeCloseTo(CIVILIAN_HP - MILITARY_PROFILES.archer.damage, 10);
    expect(deaths).toEqual([]);
    expect(hits).not.toHaveBeenCalled();
    fire();
    tick(60);
    expect(deaths).toEqual([civilian.uid]);
    expect(actors).not.toContain(civilian);
    expect(civilians.isTarget(civilian.uid)).toBe(false);
    expect(civilians.save()).toEqual({ civilianDeaths: 1 });
  });

  it("uses six tiles as the civilian range and backs away from a civilian inside the minimum range", () => {
    expect(CIVILIAN_ARCHER_RANGE).toBe(6);
    const { civilian, hunt, routing, state } = fixture();
    civilian.x = 20 + CIVILIAN_ARCHER_RANGE + .1;
    expect(hunt()).toBe(false);
    civilian.x = 20 + CIVILIAN_ARCHER_RANGE;
    expect(hunt()).toBe(true);
    state.pendingTarget = undefined; state.attackTime = 0; state.cooldown = 0;
    // Too close: the archer kites (one retreat step), it does not draw.
    civilian.x = 20 + MILITARY_PROFILES.archer.minimumRange - .1;
    expect(hunt()).toBe(true);
    expect(routing.backAway).toHaveBeenCalledWith(expect.anything(), state, civilian, .05);
    expect(state.pendingTarget).toBeUndefined();
    // Cornered (no way back): it carries on as before instead of shooting point-blank.
    routing.backAway.mockReturnValueOnce(0);
    expect(hunt()).toBe(false);
    civilian.x = 20 + MILITARY_PROFILES.archer.minimumRange;
    expect(hunt()).toBe(true);
    expect(state.pendingTarget).toBe(civilian.uid);
  });

  it("prefers a player soldier to a civilian, and refuses to hunt while soldier-targeted", () => {
    const { archery, civilian, context, hunt, shooter, soldiers, state } = fixture();
    soldiers.set(4, soldierOf("archer", 4, 0));
    const guardBody = soldierBody(4, 23, 20);
    context.actors.push(guardBody);
    const grid = createMilitarySpatialGrid<SettlementActor>(SIZE, SIZE);
    grid.rebuild([guardBody]);
    const factionOf = (id: number) => soldiers.get(id)?.combat?.faction;
    const isEnemyOf = (faction: number) => (body: SettlementActor) => {
      const other = factionOf(body.uid);
      return other !== undefined && other !== faction && soldiers.has(body.uid);
    };
    const core = {
      archery, context, factionOf, grid,
      inField: (body?: SettlementActor) => body?.phase === "militaryField" && Boolean(body.visible),
      // Every unit is in sight in this fixture (A13 phase 3 knowledge).
      isEnemyOf, isKnownEnemyOf: isEnemyOf, knowledge: { knows: () => true, troopKnows: () => true },
      melee: { claimCount: () => 0 },
      sieges: { isDefender: () => false },
      soldiers
    } as unknown as CombatCore;
    const target = createCombatTargeting(core, { heroUid: () => undefined, weightsOf: () => ({ danger: 0, focus: 0 }) })
      .chooseTarget(shooter, state, "camp", { seekTime: 0, struck: false });
    expect(target?.body.uid).toBe(guardBody.uid);
    state.target = guardBody.uid;
    expect(hunt()).toBe(false);
    state.target = undefined;
    expect(hunt()).toBe(true);
    expect(state.pendingTarget).toBe(civilian.uid);
  });

  it("spares civilians indoors, crews aboard or on the pier, mounts and enemy staff; crews on land are targets", () => {
    const isSoldier = () => false;
    expect(isAttackableCivilian(civilianBody(5, 0, 0), isSoldier)).toBe(true);
    for (const extra of [{ visible: false }, { navalOrder: 1 }, { phase: "navalAboard" },
      { navalOrder: 1, phase: "navalToShip" }, { hostileCivilianFaction: 1 }, { job: "Mount" },
      { job: "Commander" }, { phase: "retired" }])
      expect(isAttackableCivilian(civilianBody(5, 0, 0, extra), isSoldier), JSON.stringify(extra)).toBe(false);
    // MIL-CREWS (owner 2026-11-09): cart crews, boat crews, voyage helpers on land, roof porters.
    for (const extra of [{ handcart: {} }, { boatWork: 1 },
      { navalOrder: 1, phase: "navalToHarbour" }, { navalOrder: 0, phase: "navalEnterHarbour" },
      { phase: "catapultResupply" }])
      expect(isAttackableCivilian(civilianBody(5, 0, 0, extra), isSoldier), JSON.stringify(extra)).toBe(true);
    expect(isAttackableCivilian(civilianBody(5, 0, 0), uid => uid === 5)).toBe(false);
  });

  it("heals a wounded civilian once it enters a building", () => {
    const { civilian, civilians, fire, tick } = fixture();
    fire();
    tick(60);
    expect(civilians.save().woundedCivilians).toEqual([
      { actor: civilian.uid, hp: CIVILIAN_HP - MILITARY_PROFILES.archer.damage }]);
    civilian.visible = false;
    civilians.update();
    expect(civilians.hitPoints(civilian.uid)).toBe(CIVILIAN_HP);
    expect(civilians.save()).toEqual({});
  });

  it("a killed carrier loses cargo and claim; a killed worker frees its workplace and loses its tool", () => {
    const destination = { uid: 30, typeId: 7, incoming: { planks: 1 }, inventory: {} };
    const workplace = { uid: 31, typeId: 5, worker: 3, working: true, incoming: {}, inventory: {} };
    const { actors, civilian, civilians, context, deaths, shooter, soldiers, state } =
      fixture([destination, workplace], "heavy");
    Object.assign(civilian, { delivery: { destination: 30, source: 40, ware: "planks" }, ware: "planks", x: 20.5 });
    const worker = civilianBody(3, 19.3, 20, { job: "Woodcutter", tool: "axe", building: 31, home: 31 });
    actors.push(worker);
    const routing = { backAway: vi.fn(() => 0), plan: vi.fn(), stand: vi.fn(), walk: vi.fn() };
    const strike = () => {
      state.cooldown = 0;
      expect(civilians.hunt(shooter, state, 0, { stance: "camp" }, .05, routing)).toBe(true);
    };
    strike(); strike();
    expect(deaths).toEqual([civilian.uid]);
    expect(destination.incoming.planks).toBe(0);
    expect(civilian.ware).toBeNull();
    civilians.update();
    strike(); strike();
    expect(deaths).toEqual([civilian.uid, worker.uid]);
    expect(worker.tool).toBeUndefined();
    expect(workplace.worker).toBeUndefined();
    expect(context.actors).toEqual([shooter]);
    expect(soldiers.size).toBe(1);
    expect(civilians.save()).toEqual({ civilianDeaths: 2 });
  });

  it("never shoots through a wall: the arrow stops and the civilian is unharmed", () => {
    const wall = { uid: 9, construction: 1, x: 22.5, z: 20, y: 0, width: 1, depth: 4 };
    const { actors, civilian, civilians, deaths, fire, tick } = fixture([wall]);
    fire();
    tick(60);
    expect(civilians.hitPoints(civilian.uid)).toBe(CIVILIAN_HP);
    expect(deaths).toEqual([]);
    expect(actors).toContain(civilian);
  });

  it("round-trips a save mid-flight and stays deterministic", () => {
    const first = fixture();
    // Two arrows are in flight at the save: a wounded civilian must stay a target for the second.
    first.fire();
    first.fire();
    first.tick(3);
    const saved = JSON.parse(JSON.stringify({ arrows: first.archery.save(), civilians: first.civilians.save() }));
    const second = fixture();
    second.archery.restore(saved.arrows);
    second.civilians.restore(saved.civilians);
    const trace: string[] = [], restoredTrace: string[] = [];
    for (let index = 0; index < 60; index++) {
      first.tick(1); second.tick(1);
      trace.push(JSON.stringify(first.civilians.save()));
      restoredTrace.push(JSON.stringify(second.civilians.save()));
    }
    expect(restoredTrace).toEqual(trace);
    expect(second.deaths).toEqual([second.civilian.uid]);
    expect(first.deaths).toEqual([first.civilian.uid]);
  });
});

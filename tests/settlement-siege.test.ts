import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { DOOR_ARCHER_DAMAGE, MAX_DOOR_ATTACKERS, MILITARY_PROFILES } from "../src/shared/balance/military";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { applyNationalDefence } from "../src/shared/settlement/nation-bonuses";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (firstType: "heavy" | "archer" = "heavy", rotation = 0) => {
  const size = 48;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { sword: 4, shield: 4, beer: 4, bow: 4, axe: 4, planks: 80, stone: 80 },
    canWorkerEnterPlot: () => true });
  const place = (type: number, x: number, z: number, turn = 0) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const across = turn % 2 ? depth : width, along = turn % 2 ? width : depth;
    const result = simulation.placeBuilding(type, Math.floor(x) + across % 2 / 2, Math.floor(z) + along % 2 / 2, turn);
    if (!result.ok || !result.building) throw new Error(result.reason);
    const site = result.building; site.construction = 1; site.required = {};
    return site;
  };
  const advance = (seconds: number) => {
    for (let step = 0; step < seconds * 20; step++) simulation.update(.05);
  };
  const friendly = place(1, 15, 12); roads.addRoad(simulation.headquarters.access, friendly.access);
  // Recruit the fixed types directly: after recruitment they can no longer be converted.
  simulation.recruitStoredMilitary(simulation.headquarters.uid, firstType);
  for (let index = 0; index < 3; index++) simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
  advance(120);
  const target = place(2, 25.5, 16.5, rotation); simulation.setMilitaryTarget(target.uid, 0);
  // Attack with actual reserves; the occupied friendly barracks keeps its permanent defender(s).
  const ids = simulation.frames().filter(actor => actor.phase === "militaryReserve").map(actor => actor.uid);
  simulation.commandMilitary(ids, { x: 23, z: 22 });
  // The existing garrison is untouched, so returning attackers remain in reserve.
  advance(30);
  const guard = (type: "shield" | "heavy" | "archer", offset: number) => {
    const id = simulation.spawnMilitaryOpponent({ x: 31 + offset, z: 27 }, type)!;
    if (id === null) throw new Error("No guard position");
    return id;
  };
  return { simulation, target, friendly, ids, guard, advance };
};

describe("physical military doorway exchanges", () => {
  it("lets supporting archers shoot exposed tower guards while the doorway duel stays melee-only", () => {
    const { advance, guard, ids, simulation, target } = fixture("archer");
    const archers = [guard("archer", 0), guard("archer", 1)], defender = guard("shield", 2);
    expect(simulation.registerMilitaryGarrison(target.uid, [...archers, defender], 1)).toBe(true);
    expect(simulation.siegeMilitary(ids, target.uid)).toBe(true);
    let supported = false, shotDefender = false;
    for (let tick = 0; tick < 2400 && !supported; tick++) {
      advance(.05);
      const own = simulation.militarySoldiers().find(soldier => soldier.actor === ids[0])?.combat;
      if (!own) continue;
      const duel = simulation.saveState().military!.combat!.exchanges?.find(exchange => exchange.stage === "duel");
      // The supporting archer draws on an exposed post archer; it can die to the post archers just
      // before the melee attacker's doorway duel starts, so support need not overlap a live duel.
      shotDefender ||= duel !== undefined &&
        (own.target === duel.defender || own.pendingTarget === duel.defender);
      supported ||= archers.includes(own.target ?? -1) && (own.attackTime ?? 0) > 0;
    }
    expect(shotDefender).toBe(false);
    expect(supported).toBe(true);
  });
  it("lets the nearby attacker fight while a distant lower-id soldier is still travelling", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("shield", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1)).toBe(true);
    const saved = simulation.saveState();
    const near = saved.actors.find(body => body.uid === ids[1])!;
    const far = saved.actors.find(body => body.uid === ids[0])!;
    Object.assign(near, { x: target.access.x, z: target.access.z + 1, path: [], pathIndex: 0 });
    Object.assign(far, { x: target.access.x + 12, z: target.access.z + 12, path: [], pathIndex: 0 });
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.siegeMilitary(ids, target.uid)).toBe(true);
    advance(.05);
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === ids[1])!.combat?.marchSpeed).toBeUndefined();
    let fought = false;
    for (let step = 0; step < 160 && !fought; step++) {
      advance(.05);
      const exchange = simulation.saveState().military!.combat!.exchanges?.[0];
      if (exchange?.stage !== "duel") continue;
      expect(exchange.attacker).toBe(ids[1]);
      const late = simulation.frames().find(body => body.uid === ids[0])!;
      expect(Math.hypot(late.x - target.workerApproach.x, late.z - target.workerApproach.z)).toBeGreaterThan(1.5);
      fought = true;
    }
    expect(fought).toBe(true);
  });

  it("hands a distant doorway reservation to another attacker that reaches the entrance first", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("shield", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1)).toBe(true);
    expect(simulation.siegeMilitary(ids, target.uid)).toBe(true);
    advance(.05);
    const saved = simulation.saveState();
    const exchange = saved.military!.combat!.exchanges![0]!;
    const first = ids.find(id => id !== exchange.attacker)!;
    const body = saved.actors.find(body => body.uid === first)!;
    Object.assign(body, { x: target.workerApproach.x, z: target.workerApproach.z + 1,
      path: [], pathIndex: 0, action: "idle" });
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(.05);
    expect(simulation.saveState().military!.combat!.exchanges![0]!.attacker).toBe(first);
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === defender)!.stationed).toBe(false);
  });

  it.each([0, 1, 2, 3])("keeps the guard inside until the attacker reaches entrance rotation %i after reload", rotation => {
    const { advance, guard, ids, simulation, target } = fixture("heavy", rotation);
    const defender = guard("shield", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1)).toBe(true);
    expect(simulation.siegeMilitary([ids[0]!], target.uid)).toBe(true);
    advance(.05);
    const stationed = () => simulation.militarySoldiers().find(soldier => soldier.actor === defender)!.stationed;
    expect(stationed()).toBe(true);
    expect(simulation.frames().find(body => body.uid === defender)!.visible).toBe(false);
    expect(simulation.saveState().military!.combat!.exchanges?.[0]?.stage).toBe("approach");
    const invalid = simulation.saveState();
    invalid.military!.combat!.exchanges![0]!.stage = "duel";
    expect(simulation.loadState(invalid)).toEqual({ ok: false, reason: "Invalid doorway exchange references" });
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    for (let step = 0; step < 800 && stationed(); step++) {
      const attacker = simulation.frames().find(body => body.uid === ids[0])!;
      const distance = Math.hypot(attacker.x - target.workerApproach.x, attacker.z - target.workerApproach.z);
      advance(.05);
      if (distance > 1.5) expect(stationed()).toBe(true);
      if (!stationed()) expect(distance).toBeLessThanOrEqual(1.5);
    }
    expect(stationed()).toBe(false);
    expect(simulation.frames().find(body => body.uid === defender)!.visible).toBe(true);
  });

  it("cancels a distant approach without sending the waiting guard through the entrance", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("shield", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1)).toBe(true);
    expect(simulation.siegeMilitary([ids[0]!], target.uid)).toBe(true);
    advance(.05);
    const before = { ...simulation.frames().find(body => body.uid === defender)! };
    expect(simulation.commandMilitary([ids[0]!], { x: 22, z: 24 })).toBe(true);
    advance(.05);
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === defender)!.stationed).toBe(true);
    const after = simulation.frames().find(body => body.uid === defender)!;
    expect(after.visible).toBe(false);
    expect(after.phase).toBe("garrison");
    expect({ x: after.x, z: after.z }).toEqual({ x: before.x, z: before.z });
    expect(simulation.saveState().military!.combat!.exchanges).toEqual([]);
  });

  it("rejects excess, duplicate and player garrisons without changing resources or ownership", () => {
    const { guard, ids, simulation, target } = fixture();
    const enemies = [guard("shield", 0), guard("heavy", 1), guard("archer", 2), guard("archer", 3)];
    const stock = { ...simulation.headquarters.inventory }, population = simulation.availableSettlers();
    expect(simulation.registerMilitaryGarrison(target.uid, enemies, 1)).toBe(false);
    expect(simulation.registerMilitaryGarrison(target.uid, [enemies[0]!, enemies[0]!], 1)).toBe(false);
    expect(simulation.registerMilitaryGarrison(target.uid, ids, 1)).toBe(false);
    expect(target.militaryFaction).toBeUndefined();
    expect(simulation.registerMilitaryGarrison(target.uid, enemies.slice(0, 3), 1)).toBe(true);
    expect(simulation.headquarters.inventory).toEqual(stock);
    expect(simulation.availableSettlers()).toBe(population);
    expect(simulation.militaryBuildings().some(site => site.uid === target.uid)).toBe(false);
    expect(simulation.territory().sources.some(site => site.uid === target.uid)).toBe(false);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });

  it("releases melee guards before the final archer, persists the duel, then physically captures", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const archer = guard("archer", 0), shield = guard("shield", 1), heavy = guard("heavy", 2);
    expect(simulation.registerMilitaryGarrison(target.uid, [archer, shield, heavy], 1, 20)).toBe(true);
    const saved = simulation.saveState();
    for (const soldier of saved.military!.soldiers) if (soldier.combat?.faction === 1) soldier.combat!.hp = 2;
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.siegeMilitary(ids, target.uid)).toBe(true);
    const order: number[] = []; let persisted = false, archerAtDoor = false, crossed = false;
    for (let step = 0; step < 2400; step++) {
      advance(.05);
      const state = simulation.saveState(), exchange = state.military!.combat!.exchanges?.[0];
      if (exchange?.defender !== undefined && order.at(-1) !== exchange.defender) order.push(exchange.defender);
      if (exchange?.stage === "duel" && !persisted) {
        expect(simulation.loadState(state)).toEqual({ ok: true }); persisted = true;
      }
      if (exchange?.defender === archer && exchange.stage === "duel") {
        // The last defender shoots its bow point-blank at the door (half damage), never arrows in flight.
        archerAtDoor = true;
        expect(simulation.militarySoldiers().some(soldier => [shield, heavy].includes(soldier.actor))).toBe(false);
        expect(simulation.frames().find(body => body.uid === archer)?.tool).toBe("bow");
        expect(simulation.militaryArrows().some(arrow => arrow.shooter === archer)).toBe(false);
      }
      const site = simulation.buildings().find(site => site.uid === target.uid)!;
      if (site.militaryFaction === 0) {
        const victor = simulation.militarySoldiers().find(soldier => soldier.building === target.uid)!;
        const body = simulation.frames().find(body => body.uid === victor.actor)!;
        crossed = Math.hypot(body.x - site.doorThreshold.x, body.z - site.doorThreshold.z) < .08;
        expect(victor.stationed).toBe(true); break;
      }
    }
    expect(order).toEqual([shield, heavy, archer]); expect(persisted).toBe(true);
    expect(archerAtDoor).toBe(true); expect(crossed).toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });

  it("cancels a live duel and returns its defender through the entrance without changing issued gear", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("archer", 0);
    simulation.registerMilitaryGarrison(target.uid, [defender], 1);
    simulation.siegeMilitary([ids[0]!], target.uid);
    for (let step = 0; step < 800 && simulation.saveState().military!.combat!.exchanges?.[0]?.stage !== "duel"; step++) advance(.05);
    expect(simulation.saveState().military!.combat!.exchanges?.[0]?.stage).toBe("duel");
    expect(simulation.commandMilitary([ids[0]!], { x: 22, z: 24 })).toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true }); advance(15);
    const soldier = simulation.militarySoldiers().find(soldier => soldier.actor === defender)!;
    expect(soldier.stationed).toBe(true); expect(soldier.combat!.doorMelee).toBeUndefined();
    expect(simulation.frames().find(body => body.uid === defender)?.tool).toBe("bow");
    expect(simulation.saveState().military!.combat!.exchanges).toEqual([]);
    expect(simulation.militaryDoors().find(door => door.building === target.uid)?.faction).toBe(1);
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === ids[0])?.combat?.type).toBe("heavy");
    expect(soldier.combat!.hp).toBeLessThanOrEqual(militaryHealth("archer", 0));
  });

  it("rejects duplicated exchanges and ownership tampering atomically", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    simulation.registerMilitaryGarrison(target.uid, [guard("shield", 0)], 1);
    simulation.siegeMilitary([ids[0]!], target.uid); advance(1);
    const before = simulation.saveState();
    const duplicate = simulation.saveState();
    duplicate.military!.combat!.exchanges!.push({ ...duplicate.military!.combat!.exchanges![0]! });
    expect(simulation.loadState(duplicate).ok).toBe(false);
    expect(simulation.saveState()).toEqual(before);
    const corrupt = simulation.saveState();
    corrupt.buildings.find(site => site.uid === target.uid)!.militaryFaction = 0;
    expect(simulation.loadState(corrupt).ok).toBe(false);
    expect(simulation.saveState()).toEqual(before);
  });

  it("returns home from an active doorway duel and keeps hostile survivors outside a demolished building", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const guards = [guard("archer", 0), guard("shield", 1)];
    simulation.registerMilitaryGarrison(target.uid, guards, 1);
    simulation.siegeMilitary([ids[0]!], target.uid);
    for (let step = 0; step < 800 && simulation.saveState().military!.combat!.exchanges?.[0]?.stage !== "duel"; step++) advance(.05);
    expect(simulation.returnMilitaryHome([ids[0]!])).toBe(true);
    advance(75);
    expect(simulation.frames().find(body => body.uid === ids[0])?.phase).toBe("militaryReserve");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    simulation.commandMilitary([ids[0]!], { x: 23, z: 22 }); advance(15);
    simulation.siegeMilitary([ids[0]!], target.uid); advance(2);
    const stock = { ...simulation.headquarters.inventory };
    expect(simulation.demolishBuilding(target.uid).ok).toBe(false);
    target.inventory.coins = 7;
    expect(simulation.removeMilitaryScenarioBuilding(target.uid).ok).toBe(true); advance(5);
    expect(simulation.militaryDoors().some(door => door.building === target.uid)).toBe(false);
    expect(simulation.saveState().military!.combat!.exchanges).toEqual([]);
    expect(simulation.militarySoldiers().filter(soldier => guards.includes(soldier.actor))
      .every(soldier => soldier.building === -3 && !soldier.stationed)).toBe(true);
    // Defenders do not retire into the player's warehouse or refund their scenario gear.
    for (const ware of ["sword", "shield", "axe", "bow", "beer", "coins"])
      expect(simulation.headquarters.inventory[ware]).toBe(stock[ware]);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });

  it("restores the surviving guard after an attacker dies and permits another attacker", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("shield", 0);
    simulation.registerMilitaryGarrison(target.uid, [defender], 1);
    simulation.siegeMilitary([ids[0]!], target.uid);
    const saved = simulation.saveState(); saved.military!.soldiers.find(soldier => soldier.actor === ids[0])!.combat!.hp = 1;
    expect(simulation.loadState(saved)).toEqual({ ok: true }); advance(30);
    expect(simulation.militarySoldiers().some(soldier => soldier.actor === ids[0])).toBe(false);
    expect(simulation.militarySoldiers().find(soldier => soldier.actor === defender)?.stationed).toBe(true);
    expect(simulation.saveState().military!.combat!.exchanges).toEqual([]);
    expect(simulation.siegeMilitary([ids[1]!], target.uid)).toBe(true);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  });

  it("drops a door reservation whose attacker stopped getting nearer, then fights", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("shield", 0);
    simulation.registerMilitaryGarrison(target.uid, [defender], 1);
    simulation.siegeMilitary([ids[0]!], target.uid);
    advance(.05);
    // Boxed in under the walls: the reserved attacker stands 3 tiles out with nowhere left to walk.
    const saved = simulation.saveState(), approach = target.workerApproach;
    expect(saved.military!.combat!.exchanges![0]).toMatchObject({ attacker: ids[0], stage: "approach" });
    Object.assign(saved.actors.find(body => body.uid === ids[0])!,
      { path: [], pathIndex: 0, x: approach.x + 3, z: approach.z });
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(8);
    expect(simulation.saveState().military!.combat!.exchanges![0]!.stage).toBe("approach");
    let fought = false;
    for (let step = 0; step < 400 && !fought; step++) {
      advance(.05);
      fought = simulation.saveState().military!.combat!.exchanges?.[0]?.stage === "duel";
    }
    expect(fought).toBe(true);
  });

  it("starts the duel when the attacker stands on the defender's way to its stance", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("shield", 0);
    simulation.registerMilitaryGarrison(target.uid, [defender], 1);
    simulation.siegeMilitary([ids[0]!], target.uid);
    const out = () => simulation.militarySoldiers().find(soldier => soldier.actor === defender)?.stationed === false;
    for (let step = 0; step < 1200 && !out(); step++) advance(.05);
    expect(out()).toBe(true);
    // The attacker was pushed onto the defender's stance: the defender, held off half a tile away, never arrives.
    const saved = simulation.saveState(), approach = target.workerApproach;
    const attacker = saved.actors.find(body => body.uid === ids[0])!;
    const guardBody = saved.actors.find(body => body.uid === defender)!;
    Object.assign(attacker, { path: [{ ...approach }], pathIndex: 1, x: approach.x, z: approach.z });
    Object.assign(guardBody, { path: [{ ...approach }], pathIndex: 0, x: approach.x + .3, z: approach.z + .3 });
    expect(saved.military!.combat!.exchanges![0]!.stage).toBe("approach");
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    advance(.05);
    expect(simulation.saveState().military!.combat!.exchanges![0]!.stage).toBe("duel");
  });


  it("lets the last archer defender shoot its bow point-blank at half damage", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const archer = guard("archer", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [archer], 1)).toBe(true);
    expect(simulation.siegeMilitary([ids[0]!], target.uid)).toBe(true);
    const health = () => simulation.militarySoldiers().find(soldier => soldier.actor === ids[0])?.combat?.hp ?? 0;
    const hits: number[] = [];
    for (let step = 0, before = health(); step < 2400 && hits.length < 3 && before > 0; step++) {
      advance(.05);
      const after = health();
      if (after < before) hits.push(Math.round((before - after) * 1000) / 1000);
      before = after;
    }
    // The fixture runs as the default Roman player: +5% soldier health mitigates every blow
    // (owner 2026-10-31, docs/decisions/09-national-bonuses.md).
    const baseDamage = MILITARY_PROFILES.archer.damage * (1 - MILITARY_PROFILES.heavy.armour[0]!) * DOOR_ARCHER_DAMAGE;
    const full = applyNationalDefence(baseDamage, "roman", "heavy", 0);
    const allowed = [full, full / 2].map(value => Math.round(value * 1000) / 1000);
    expect(hits.length).toBeGreaterThan(0);
    for (const damage of hits) expect(allowed).toContain(damage);
    expect(simulation.frames().find(body => body.uid === archer)?.tool).toBe("bow");
  });

  /** Five more rank 0 swordsmen called out next to the guardhouse, besieging it with the fixture's soldiers. */
  const crowdAtDoor = (setup: ReturnType<typeof fixture>) => {
    const { advance, ids, simulation, target } = setup;
    simulation.receiveTroops(Array.from({ length: 5 }, () => ({ hp: militaryHealth("shield", 0), rank: 0,
      type: "shield" as const })));
    simulation.callOutMilitary(["shield"], { x: 23, z: 22 }); advance(40);
    const attackers = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0 &&
      !soldier.stationed).map(soldier => soldier.actor);
    expect(attackers.length).toBeGreaterThanOrEqual(ids.length + 4);
    expect(simulation.siegeMilitary(attackers, target.uid)).toBe(true);
    return attackers;
  };
  const exchangeOf = (simulation: ReturnType<typeof fixture>["simulation"]) =>
    simulation.saveState().military!.combat!.exchanges?.[0];

  it(`lets ${MAX_DOOR_ATTACKERS} melee attackers fight the door defender at once while the rest queue`, () => {
    const setup = fixture(), { advance, guard, simulation, target } = setup;
    const defender = guard("heavy", 3);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1)).toBe(true);
    const attackers = crowdAtDoor(setup);
    let most = 0, persisted = false;
    for (let step = 0; step < 2400 && simulation.militarySoldiers().some(soldier => soldier.actor === defender); step++) {
      advance(.05);
      if (exchangeOf(simulation)?.stage !== "duel") continue;
      const guardBody = simulation.frames().find(body => body.uid === defender)!;
      // Attackers mid-swing beside the defender are the ones fighting it.
      const fighting = simulation.militarySoldiers().filter(soldier => attackers.includes(soldier.actor) &&
        (soldier.combat?.attackTime ?? 0) > 0).map(soldier => simulation.frames().find(body => body.uid === soldier.actor)!)
        .filter(body => Math.hypot(body.x - guardBody.x, body.z - guardBody.z) < 1.2);
      most = Math.max(most, fighting.length);
      if (fighting.length === MAX_DOOR_ATTACKERS && !persisted) {
        expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true }); persisted = true;
      }
    }
    expect(simulation.militarySoldiers().some(soldier => soldier.actor === defender)).toBe(false);
    expect(most).toBe(MAX_DOOR_ATTACKERS); expect(persisted).toBe(true);
  });

  it("hands the duel to a flank attacker when the duelling attacker falls, keeping the defender outside", () => {
    const setup = fixture(), { advance, guard, simulation, target } = setup;
    const defender = guard("heavy", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1)).toBe(true);
    crowdAtDoor(setup);
    // Wait until the flank attackers stand beside the duel, then let the duelling attacker nearly die.
    for (let step = 0; step < 2400; step++) {
      advance(.05);
      const state = simulation.saveState(), exchange = state.military!.combat!.exchanges?.[0];
      const swinging = state.military!.soldiers.filter(soldier => (soldier.combat?.faction ?? 0) === 0 &&
        (soldier.combat?.attackTime ?? 0) > 0).length;
      if (exchange?.stage !== "duel" || swinging < MAX_DOOR_ATTACKERS) continue;
      state.military!.soldiers.find(soldier => soldier.actor === exchange.attacker)!.combat!.hp = .01;
      expect(simulation.loadState(state)).toEqual({ ok: true });
      const first = exchange.attacker;
      for (let wait = 0; wait < 200 && simulation.militarySoldiers().some(soldier => soldier.actor === first); wait++)
        advance(.05);
      expect(simulation.militarySoldiers().some(soldier => soldier.actor === first)).toBe(false);
      const next = exchangeOf(simulation);
      expect(next?.stage).toBe("duel"); expect(next?.defender).toBe(defender);
      expect(next?.attacker).not.toBe(first);
      expect(simulation.militarySoldiers().find(soldier => soldier.actor === defender)?.stationed).toBe(false);
      expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
      return;
    }
    throw new Error("The flank attackers never joined the duel");
  });

  it("sends a melee soldier ahead to break an emptied door even when an archer has the lowest id", () => {
    const { advance, guard, ids, simulation, target } = fixture("archer");
    const defender = guard("shield", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1, 20)).toBe(true);
    const saved = simulation.saveState();
    for (const soldier of saved.military!.soldiers) if (soldier.combat?.faction === 1) soldier.combat!.hp = 1;
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.siegeMilitary(ids, target.uid)).toBe(true);
    let captured = false;
    for (let second = 0; second < 120 && !captured; second++) {
      advance(1);
      captured = simulation.buildings().find(building => building.uid === target.uid)!.militaryFaction === 0;
    }
    expect(captured).toBe(true);
  });

  // Owner decision 2026-10-13: riders join a siege (they hunt reinforcements and may fight on foot
  // at the door) but never queue mounted and never capture.
  it("keeps riders out of the door queue and capture, and breaks the door while a distant enemy lives", () => {
    const { advance, guard, ids, simulation, target } = fixture();
    const defender = guard("shield", 0);
    expect(simulation.registerMilitaryGarrison(target.uid, [defender], 1, 20)).toBe(true);
    const saved = simulation.saveState();
    for (const soldier of saved.military!.soldiers) if (soldier.combat?.faction === 1) soldier.combat!.hp = 1;
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    const distant = simulation.spawnMilitaryOpponent({ x: 6.5, z: 42.5 }, "shield");
    expect(distant).not.toBeNull();
    simulation.receiveTroops([{ hp: militaryHealth("cavalry", 0), rank: 0, type: "cavalry" }]);
    const rider = simulation.militarySoldiers().find(soldier => soldier.combat?.type === "cavalry")!.actor;
    expect(simulation.siegeMilitary([...ids, rider], target.uid)).toBe(true);
    const siegeOf = (id: number) => simulation.militarySoldiers().find(soldier => soldier.actor === id)?.combat?.siege;
    expect(siegeOf(rider)).toBe(target.uid);
    let captured = false;
    for (let second = 0; second < 180 && !captured; second++) {
      advance(1);
      captured = simulation.buildings().find(building => building.uid === target.uid)!.militaryFaction === 0;
    }
    expect(captured).toBe(true);
    expect(simulation.militarySoldiers().filter(soldier => soldier.building === target.uid)
      .every(soldier => soldier.combat?.type !== "cavalry")).toBe(true);
    expect(simulation.militarySoldiers().some(soldier => soldier.actor === distant)).toBe(true);
  });
});

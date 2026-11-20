import { expect, it } from "vitest";

import { banditSiteOfMilitaryType, placedBanditCamp } from "../src/render-common/buildings/bandit-camp-plan";
import { createBanditCampRecipe } from "../src/render-common/buildings/bandit-camp-recipe";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  courtyardProjectileWalls,
  courtyardWallAt
} from "../src/shared/settlement/event-courtyard";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { editSavedOccupancy } from "./helpers/saved-occupancy";

const fixture = (
  type: "heavy" | "archer" = "heavy",
  defender: "shield" | "archer" = "archer",
  wallHp: number | null = 30,
  buildingType = 9
) => {
  const size = 40;
  const world = {
    seed: 9,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2),
    mineZones: [],
    props: {
      count: 0,
      types: new Uint8Array(),
      x: new Float32Array(),
      z: new Float32Array(),
      scale: new Float32Array()
    }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({
    world,
    roads,
    initialSettlers: 20,
    initialStock: { planks: 80, stone: 80 },
    canWorkerEnterPlot: () => true
  });
  simulation.receiveTroops([{ type, rank: 2, hp: militaryHealth(type, 2) }]);
  simulation.callOutMilitary([type], { x: 20, z: 24.5 });
  for (let second = 0; second < 90; second++) simulation.update(1);
  const [width, depth] = getBuildingDefinition(buildingType).gridFootprint;
  const placed = simulation.placeBuilding(buildingType, 20 + (width % 2) / 2, 20 + (depth % 2) / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const saved = simulation.saveState(),
    site = saved.buildings.find((building) => building.uid === placed.building!.uid)!;
  // This fixture changes the plot dimensions; clear the old reservation before claiming the new plot.
  editSavedOccupancy(saved, grid => {
    for (let z = site.z - site.depth / 2; z < site.z + site.depth / 2; z++)
      for (let x = site.x - site.width / 2; x < site.x + site.width / 2; x++)
        grid[z * size + x] = 0;
    grid[Math.floor(site.access.z) * size + Math.floor(site.access.x)] = 0;
  });
  Object.assign(
    site,
    {
      x: 20,
      z: 20,
      bandit: banditSiteOfMilitaryType(buildingType, 0),
      militaryFaction: 1,
      construction: 1,
      required: {},
      hasDoor: true
    },
    placedBanditCamp(banditSiteOfMilitaryType(buildingType, 0), 20, 20)
  );
  editSavedOccupancy(saved, grid => {
    for (let z = site.z - site.depth / 2; z < site.z + site.depth / 2; z++)
      for (let x = site.x - site.width / 2; x < site.x + site.width / 2; x++)
        grid[z * size + x] = 1;
  });
  if (wallHp !== null)
    site.eventCourtyard = {
      walls: Array.from({ length: 4 }, () => ({ hp: wallHp, maximum: wallHp }))
    };
  saved.military!.combat!.doors.push({
    building: site.uid,
    faction: 1,
    hp: 200,
    maximum: 200,
    structure: { hp: 35000, maximum: 35000 }
  });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const guard = simulation.spawnMilitaryOpponent({ x: 14, z: 20 }, defender)!;
  expect(
    simulation.registerMilitaryGarrison(site.uid, [guard], 1, 200, { hp: 35000, maximum: 35000 })
  ).toBe(true);
  const attacker = simulation
    .militarySoldiers()
    .find((soldier) => soldier.combat?.faction === 0)!.actor;
  expect(
    simulation.buildings().find((entry) => entry.uid === site.uid)!.eventCourtyard
  ).toBeDefined();
  return { simulation, site, guard, attacker };
};

it("breaches a real event wall, opens navigation and preserves the breach on reload", () => {
  const { attacker, simulation, site } = fixture();
  expect(simulation.siegeMilitary([attacker], site.uid)).toBe(true);
  let saved = simulation.saveState();
  for (let tick = 0; tick < 1800; tick++) {
    simulation.update(0.05);
    saved = simulation.saveState();
    if (
      saved.buildings
        .find((entry) => entry.uid === site.uid)!
        .eventCourtyard!.walls.some((wall) => wall.hp === 0)
    )
      break;
  }
  const breached = saved.buildings.find((entry) => entry.uid === site.uid)!;
  expect(breached.eventCourtyard!.walls.filter((wall) => wall.hp === 0)).toHaveLength(1);
  expect(
    saved.military!.combat!.doors.find((door) => door.building === site.uid)!.structure!.hp
  ).toBe(35000);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(
    simulation.saveState().buildings.find((entry) => entry.uid === site.uid)!.eventCourtyard
  ).toEqual(breached.eventCourtyard);
  const invalid = structuredClone(saved);
  invalid.buildings.find((entry) => entry.uid === site.uid)!.eventCourtyard!.walls[0]!.hp = -1;
  expect(simulation.loadState(invalid).ok).toBe(false);
  for (const kind of ["colony", "adventure"] as const) {
    const expedition = structuredClone(saved);
    expedition[kind] = {} as never;
    expect(simulation.loadState(expedition)).toMatchObject({
      ok: false,
      reason: "Courtyard fortifications are reserved for events"
    });
  }
});

it("ordinary archers cannot besiege event stockades", () => {
  const { attacker, simulation, site } = fixture("archer");
  simulation.siegeMilitary([attacker], site.uid);
  for (let tick = 0; tick < 100; tick++) simulation.update(0.05);
  expect(
    simulation.saveState().buildings.find((entry) => entry.uid === site.uid)!.eventCourtyard!.walls
  ).toEqual(Array.from({ length: 4 }, () => ({ hp: 30, maximum: 30 })));
});

it("releases melee guards onto legal courtyard ground after a breach", () => {
  const { attacker, guard, simulation, site } = fixture("heavy", "shield");
  expect(simulation.siegeMilitary([attacker], site.uid)).toBe(true);
  for (let tick = 0; tick < 1800; tick++) {
    simulation.update(0.05);
    if (!simulation.militarySoldiers().find((soldier) => soldier.actor === guard)?.stationed) break;
  }
  const soldier = simulation.militarySoldiers().find((soldier) => soldier.actor === guard)!;
  expect(soldier).toMatchObject({ building: -3, stationed: false });
  const body = simulation.snapshot().actors.find((actor) => actor.uid === guard)!;
  expect(body.visible).toBe(true);
  expect(simulation.isOccupied(body.x, body.z)).toBe(false);
  expect(Math.abs(body.x - site.x)).toBeLessThan(4);
  expect(Math.abs(body.z - site.z)).toBeLessThan(4);
  let entered = false;
  for (let tick = 0; tick < 1200; tick++) {
    simulation.update(0.05);
    const body = simulation.snapshot().actors.find((actor) => actor.uid === attacker);
    if (body && Math.abs(body.x - site.x) < 3 && Math.abs(body.z - site.z) < 3) {
      entered = true;
      break;
    }
  }
  expect(entered).toBe(true);
});

it("removes only breached wall geometry and projectile obstructions on either detail level", () => {
  for (const detailed of [false, true])
    for (let side = 0; side < 4; side++) {
      const bandit = banditSiteOfMilitaryType(9, 0);
      const style = { bandit, theme: "forest" as const };
      const intact = createBanditCampRecipe(bandit, style, detailed);
      const breached = createBanditCampRecipe(bandit, { ...style, breachedWalls: [side] }, detailed);
      expect(intact.parts.some((part) => part.campWallSide === side)).toBe(true);
      expect(breached.parts.some((part) => part.campWallSide === side)).toBe(false);
      for (let other = 0; other < 4; other++)
        if (other !== side)
          expect(breached.parts.filter((part) => part.campWallSide === other)).toEqual(
            intact.parts.filter((part) => part.campWallSide === other)
          );
      expect(breached.hideDoor).toBe(side === 2);
      for (let rotation = 0; rotation < 4; rotation++) {
        const site = {
          typeId: 9,
          bandit,
          uid: 2,
          x: 20,
          y: 0,
          z: 20,
          width: 8,
          depth: 8,
          rotation,
          eventCourtyard: { walls: Array.from({ length: 4 }, () => ({ hp: 100, maximum: 100 })) }
        } as SettlementBuilding;
        const walls = courtyardProjectileWalls(site);
        site.eventCourtyard!.walls[side]!.hp = 0;
        expect(courtyardProjectileWalls(site)).toHaveLength(walls.length - 1);
        const angle = (rotation * Math.PI) / 2,
          x = [0, 5, 0, -5][side]!,
          z = [-5, 0, 5, 0][side]!;
        expect(
          courtyardWallAt(site, {
            x: 20 + x * Math.cos(angle) + z * Math.sin(angle),
            z: 20 - x * Math.sin(angle) + z * Math.cos(angle)
          })
        ).toBe(side);
      }
    }
});

it("collapses the central shelter, releases lookout survivors and removes the burned ruin", () => {
  const { attacker, guard, simulation, site } = fixture();
  const saved = simulation.saveState();
  const fort = saved.buildings.find((entry) => entry.uid === site.uid)!;
  fort.eventCourtyard!.walls.forEach((wall) => {
    wall.hp = 0;
  });
  saved.military!.combat!.doors.find((door) => door.building === site.uid)!.structure!.hp = 1;
  const body = saved.actors.find((actor) => actor.uid === attacker)!;
  Object.assign(body, { x: 21.333333, z: 21.55, path: [], pathIndex: 0 });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.siegeMilitary([attacker], site.uid)).toBe(true);
  for (let tick = 0; tick < 120; tick++) {
    simulation.update(0.05);
    if (simulation.militaryDoors().find((door) => door.building === site.uid)!.structure!.hp === 0)
      break;
  }
  expect(simulation.militaryDoors().find((door) => door.building === site.uid)!.structure!.hp).toBe(
    0
  );
  expect(simulation.militarySoldiers().find((soldier) => soldier.actor === guard)).toMatchObject({
    stationed: false,
    building: -3,
    combat: { fallenTowerArcher: true }
  });
  for (let second = 0; second < 90; second++) simulation.update(1);
  expect(simulation.buildings().some((building) => building.uid === site.uid)).toBe(false);
  expect(simulation.militaryDoors().some((door) => door.building === site.uid)).toBe(false);
});

it("automatically makes legacy event stockades destructible without an authoring toggle", () => {
  const { simulation, site } = fixture("heavy", "archer", null);
  expect(
    simulation.saveState().buildings.find((entry) => entry.uid === site.uid)!.eventCourtyard!.walls
  ).toEqual(Array.from({ length: 4 }, () => ({ hp: 2000, maximum: 2000 })));
});

it("also breaks the walls of small event camps", () => {
  const { attacker, simulation, site } = fixture("heavy", "archer", 30, 2);
  expect(simulation.siegeMilitary([attacker], site.uid)).toBe(true);
  for (let tick = 0; tick < 1200; tick++) {
    simulation.update(0.05);
    if (
      simulation
        .buildings()
        .find((entry) => entry.uid === site.uid)!
        .eventCourtyard!.walls.some((wall) => !wall.hp)
    )
      break;
  }
  expect(
    simulation
      .buildings()
      .find((entry) => entry.uid === site.uid)!
      .eventCourtyard!.walls.some((wall) => !wall.hp)
  ).toBe(true);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
});

it("registration supplies wall and shelter HP for an event camp without extra authoring calls", () => {
  const { simulation, site } = fixture();
  const liveSite = simulation.buildings().find((entry) => entry.uid === site.uid)!;
  liveSite.eventCourtyard = undefined;
  expect(simulation.registerMilitaryDoor(site.uid, 1)).toBe(true);
  expect(liveSite.eventCourtyard!.walls).toHaveLength(4);
  expect(simulation.militaryDoors().find((door) => door.building === site.uid)!.structure!.hp).toBe(
    50000
  );
});

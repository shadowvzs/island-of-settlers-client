import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { START_SETTLERS } from "../src/shared/balance/population";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { findGroundPath, isNavigationClear } from "../src/shared/settlement/settlement-navigation";
import { moveActor } from "../src/shared/settlement/settlement-paths";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { actorSeparation } from "../src/shared/settlement/settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementOptions } from "../src/shared/settlement/settlement-types";
import { releaseFelledProp } from "../src/shared/world/build-class";
import { BUILD, ORE, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";

const fixture = (stock = STARTER_STOCK, hooks: Partial<SettlementOptions> = {}, size = 40) => {
  const world = {
    cellsX: size, cellsZ: size, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 2, types: new Uint8Array([PROP.broadleafTree, PROP.coniferTree]),
      scale: new Float32Array([1, 1]), x: new Float32Array([16, 22]), z: new Float32Array([12, 12]) }
  } as unknown as WorldData;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const felled: number[] = [];
  simulation = createSettlementSimulation({ world, roads, initialStock: { ...stock }, onFellTree: (index) => {
    felled.push(index); world.props.types[index] = PROP_REMOVED; return true;
  }, ...hooks });
  const advance = (seconds: number) => {
    for (let step = 0; step < seconds * 10; step++) simulation!.update(0.1);
  };
  const place = (id: number, x = 12.5, z = 8, rotation = 0) => {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    const actualWidth = rotation % 2 ? depth : width;
    const actualDepth = rotation % 2 ? width : depth;
    const snappedX = Math.floor(x - actualWidth / 2) + actualWidth / 2;
    const snappedZ = Math.floor(z - actualDepth / 2) + actualDepth / 2;
    const result = simulation!.placeBuilding(id, snappedX, snappedZ, rotation);
    expect(result.ok, result.reason).toBe(true);
    const building = result.building!;
    expect(simulation!.connectRoads(simulation!.headquarters.access, building.access)).toBe(true);
    return building;
  };
  return { world, roads, simulation, felled, advance, place };
};
describe("settlement economy", () => {
  it.each([0, 7, 125])("honors a custom initial population of %i without changing starter wares", initialSettlers => {
    const { simulation } = fixture(STARTER_STOCK, { initialSettlers });
    expect(simulation.availableSettlers()).toBe(initialSettlers);
    expect(simulation.snapshot().settlersInside).toBe(initialSettlers);
    expect(simulation.headquarters.inventory).toEqual(STARTER_STOCK);
    expect(simulation.frames()).toEqual([]);
  });

  it("starts a new home island with 20 coal and 20 iron ore", () => {
    const { simulation } = fixture();
    expect(simulation.headquarters.inventory).toMatchObject({ coal: 20, ironOre: 20 });
  });

  it("starts with a validated headquarters, actual stock and its start settlers inside", () => {
    const { simulation } = fixture();
    expect(simulation.buildings()).toHaveLength(1);
    expect(simulation.headquarters.typeId).toBe(0);
    expect(simulation.headquarters.inventory.axe).toBe(3);
    expect(simulation.frames()).toHaveLength(0);
    expect(simulation.snapshot().settlersInside).toBe(START_SETTLERS);
    expect(simulation.placeBuilding(17, 5, 5).ok).toBe(false);
  });
  it("waits for road, carrier deliveries and builder before constructing, then recruits only with an axe", () => {
    const { advance, simulation } = fixture({ ...STARTER_STOCK, axe: 0 });
    const building = simulation.placeBuilding(17, 12, 8).building!;
    advance(15);
    expect(building.construction).toBe(0);
    expect(simulation.frames()).toHaveLength(0);
    simulation.connectRoads(simulation.headquarters.access, building.access);
    advance(220);
    expect(building.construction).toBe(1);
    expect(building.status).toContain("axe");
    expect(simulation.frames().some((actor) => actor.job === "Woodcutter")).toBe(false);
  });
  it("keeps the builder's hammer attached until the return trip actually reaches storage", () => {
    const { advance, place, simulation } = fixture({ ...STARTER_STOCK, axe: 0 });
    const building = place(17);
    for (let step = 0; step < 2000 && building.construction < 1; step++) simulation.update(0.1);
    expect(building.construction).toBe(1);
    const builder = simulation.frames().find((actor) => actor.phase === "retire")!;
    expect(builder.tool).toBe("hammer");
    expect(builder.visible).toBe(true);
    expect(simulation.headquarters.inventory.hammer).toBe((STARTER_STOCK.hammer ?? 0) - 1);
    advance(40);
    expect(builder.phase).toBe("retired");
    expect(builder.visible).toBe(false);
    expect(builder.tool).toBeUndefined();
    expect(simulation.headquarters.inventory.hammer).toBe(STARTER_STOCK.hammer);
  });
  it("woodcutter takes nearest reachable mature trees, carries home and routes logs to HQ", () => {
    const { advance, felled, place, simulation } = fixture();
    const building = place(17);
    advance(300);
    expect(building.construction).toBe(1);
    expect(felled).toEqual([0, 1]);
    expect(simulation.headquarters.inventory.logs).toBe((STARTER_STOCK.logs ?? 0) + 2);
    expect(simulation.frames().filter((actor) => actor.visible)).toHaveLength(0);
  });
  it("caps shared output at six when disconnected and resumes transport on reconnection", () => {
    const { advance, place, roads, simulation } = fixture();
    const well = place(35, 12, 8);
    advance(160);
    expect(well.hasDoor).toBe(false);
    expect(well.workerApproach).toEqual(well.doorThreshold);
    expect(simulation.frames().find((actor) => actor.job === "Well worker")?.visible).toBe(true);
    const route = roads.route.bind(roads);
    roads.route = () => null;
    advance(150);
    expect(well.output.water).toBe(6);
    advance(50);
    expect(well.output.water).toBe(6);
    roads.route = route;
    advance(180);
    expect(simulation.headquarters.inventory.water).toBeGreaterThan(STARTER_STOCK.water ?? 0);
  });
  it("does not produce flour without grain and consumes one grain for one flour", () => {
    const { advance, place, simulation } = fixture({ ...STARTER_STOCK, grain: 0 });
    const mill = place(31, 12.5, 8.5);
    advance(220);
    expect(mill.construction).toBe(1);
    expect(mill.output.flour ?? 0).toBe(0);
    expect(simulation.headquarters.inventory.flour ?? 0).toBe(0);
    simulation.headquarters.inventory.grain = 2;
    advance(160);
    expect(simulation.headquarters.inventory.flour).toBe(2);
    expect(simulation.headquarters.inventory.grain).toBe(0);
  });
  it("constructs storage and transfers stock between warehouses without duplication", () => {
    const { advance, place, simulation } = fixture();
    const storage = place(29, 13.5, 8.5);
    advance(240);
    expect(storage.construction).toBe(1);
    const before = simulation.headquarters.inventory.logs;
    expect(simulation.transferWare(simulation.headquarters.uid, storage.uid, "logs", 3)).toBe(true);
    advance(130);
    expect(storage.inventory.logs).toBe(3);
    expect(simulation.headquarters.inventory.logs).toBe(before! - 3);
  });
  it("routes around actual trunks even when the forest cell remains walkable", () => {
    const { world } = fixture();
    const context = { options: { world }, occupied: new Uint8Array(world.cellsX * world.cellsZ) } as unknown as SettlementContext;
    world.walkCost[12 * world.cellsX + 16] = 22;
    const start = { x: 13.5, z: 12 };
    const path = findGroundPath(context, start, { x: 18.5, z: 12 });
    expect(path).not.toBeNull();
    expect(path!.some((point) => point.z !== 12)).toBe(true);
    let previous = start;
    for (const point of path!) {
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const x = previous.x + (point.x - previous.x) * fraction;
        const z = previous.z + (point.z - previous.z) * fraction;
        expect(Math.hypot(x - 16, z - 12)).toBeGreaterThanOrEqual(0.3);
      }
      previous = point;
    }
  });
  it("allows a released stump cell while its original tree prop remains in the world", () => {
    const { world } = fixture();
    const context = { options: { world }, occupied: new Uint8Array(1600) } as unknown as SettlementContext;
    expect(isNavigationClear(context, { x: 16, z: 12 })).toBe(false);
    releaseFelledProp(world, 0);
    expect(world.props.types[0]).toBe(PROP.broadleafTree);
    expect(isNavigationClear(context, { x: 16, z: 12 })).toBe(true);
  });
  it("rejects placing a foundation across an existing road", () => {
    const { roads, simulation } = fixture();
    expect(roads.addRoad({ x: 16, z: 8 }, { x: 20, z: 8 })).toBe(true);
    expect(simulation.placeBuilding(17, 18, 8))
      .toMatchObject({ ok: false, reason: "Plot reaches into a road's reserved stone width" });
  });
  it("skips an unreachable closer tree instead of walking through blocked terrain", () => {
    const { advance, felled, place, world } = fixture();
    for (let z = 11; z <= 13; z++)
      for (let x = 15; x <= 17; x++) world.walkCost[z * world.cellsX + x] = 0;
    place(17);
    advance(300);
    expect(felled).toEqual([1]);
  });
  it("mine consumes one alternative food, produces actual ore and depletes the deposit", () => {
    const { place, simulation, world } = fixture({ ...STARTER_STOCK, fish: 2, bread: 0, meat: 0 });
    world.mineZones.push({ id: 1, ore: ORE.coal, cellCount: 4, centreX: 12, centreZ: 8, richness: 1, surveyed: true });
    for (let z = 7; z < 9; z++)
      for (let x = 11; x < 13; x++) {
        const cell = z * world.cellsX + x;
        world.buildClass[cell] = BUILD.mine; world.mineZone[cell] = 1; world.oreAmount[cell] = 1;
      }
    const mine = place(11, 12, 8);
    let enteredWithFood = false;
    for (let step = 0; step < 3500; step++) {
      simulation.update(.1);
      for (const actor of simulation.frames()) {
        if (mine.construction !== 1) continue;
        if (actor.delivery?.destination === mine.uid && actor.ware === "fish") {
          expect(["deliveryStockWalk", "deliveryTransfer"]).not.toContain(actor.phase);
          if (actor.phase === "enterDelivery") enteredWithFood = true;
        }
        if (actor.uid === mine.worker)
          expect(["inputApproach", "inputPickup", "inputReturn"]).not.toContain(actor.phase);
      }
    }
    expect(enteredWithFood).toBe(true);
    expect(simulation.headquarters.inventory.coal, JSON.stringify({mine,actors:simulation.frames()})).toBe(2);
    expect(simulation.headquarters.inventory.fish).toBe(0);
    expect(world.oreAmount.reduce((sum, amount) => sum + amount, 0)).toBe(2);
  });
  it("validates rotated calculated plots and reserves queued construction supplies", () => {
    // Exactly one Roman Woodcutter receipt: the second site finds its supplies reserved.
    const { simulation } = fixture({ ...STARTER_STOCK, ...getConstructionCost(17, "roman") });
    expect(simulation.placeBuilding(17, 12, 8, 1).ok).toBe(true);
    expect(simulation.buildings()[1]!.width).toBe(getBuildingDefinition(17).gridFootprint[1]);
    expect(simulation.buildings()[1]!.depth).toBe(getBuildingDefinition(17).gridFootprint[0]);
    expect(simulation.placeBuilding(17, 20, 8, 1).ok).toBe(false);
  });
  it.each([21, 23, 24, 25, 26, 28, 31, 32, 33, 34, 36])(
    "production building %s consumes its actual recipe once and waits without inputs",
    (id) => {
      const rule = PRODUCTION_RULES[id]!;
      const cost = getConstructionCost(id, "roman");
      const stock = { ...STARTER_STOCK };
      for (const input of rule.inputs) stock[input] = 1;
      stock.planks = cost.planks + (rule.inputs.includes("planks") ? 1 : 0);
      stock.stone = cost.stone;
      const { advance, place, simulation, world } = fixture(stock, {}, id === 36 ? 96 : 40);
      if (id === 36) {
        // Shipyards now require a real launch site, even while making workshop boats.
        world.seaLevel = -1;
        for (let z = 0; z <= world.cellsZ; z++) for (let x = 26; x <= world.cellsX; x++)
          world.heights[z * (world.cellsX + 1) + x] = -2;
        for (let z = 0; z < world.cellsZ; z++) for (let x = 26; x < world.cellsX; x++) {
          world.walkCost[z * world.cellsX + x] = 0;
          world.blocking[z * world.cellsX + x] = 1;
        }
      }
      const building = place(id);
      // Multi-output makers (the metalworks) pick their output: count every output, adding back the
      // building costs and the worker's own tool.
      const toolUsed = (ware: string) => ware === rule.tool ? 1 : 0;
      const buildingCost = (ware: string) => (ware === "planks" || ware === "stone" ? cost[ware] : 0) + toolUsed(ware);
      const produced = () => rule.outputs.reduce((sum, ware) =>
        sum + (simulation.headquarters.inventory[ware] ?? 0) - (stock[ware] ?? 0) + buildingCost(ware), 0);
      advance(300);
      expect(building.construction).toBe(1);
      expect(produced()).toBe(1);
      for (const input of rule.inputs) expect(simulation.headquarters.inventory[input] ?? 0).toBe(0);
      advance(100);
      expect(produced()).toBe(1);
    }
  );
  it.each([37, 5])("outdoor producer %i sows, waits for persistent growth and delivers a real harvest", (id) => {
    const cost = getConstructionCost(id, "roman");
    const stock = { ...STARTER_STOCK, logs: 1, water: 1, grain: 0, planks: cost.planks, stone: cost.stone };
    const { advance, place, simulation } = fixture(stock);
    const building = place(id);
    for (let index = 0; index < 500 && !simulation.fieldFrames().length; index++) advance(1);
    expect(simulation.fieldFrames().length).toBeGreaterThan(0);
    expect(simulation.fieldFrames()[0]?.state).toBe("growing");
    const ware = id === 5 ? "grapes" : "grain";
    expect(building.output[ware] ?? 0).toBe(0);
    expect(simulation.headquarters.inventory[ware] ?? 0).toBe(0);
    advance(10);
    expect(simulation.headquarters.inventory[ware] ?? 0).toBe(0);
    advance(300);
    expect(simulation.headquarters.inventory[ware] ?? 0).toBeGreaterThan(0);
    // Like the Farm, the Vineyard plants without logs or water (owner, 2026-10-13).
    expect(simulation.headquarters.inventory.logs).toBe(1);
    expect(simulation.headquarters.inventory.water).toBe(1);
  });
  it("skinner harvests an actual reachable carcass without consuming a pig", () => {
    let available = true;
    const { advance, place, simulation } = fixture({ ...STARTER_STOCK, pig: 0 }, {
      resourceTargets: (kind) => {
        if (kind !== "carcass") return undefined;
        return available ? [{ kind, id: 900, x: 16.5, z: 10.5 }] : [];
      },
      consumeResource: (target) => {
        if (target.kind !== "carcass") return undefined;
        if (!available) return false;
        available = false; return true;
      }
    });
    const building = place(3);
    advance(300);
    expect(available).toBe(false);
    expect(simulation.headquarters.inventory.hides).toBe(1);
    expect(building.input.pig ?? 0).toBe(0);
    advance(100);
    expect(simulation.headquarters.inventory.hides).toBe(1);
  });
  it("charburner builds, burns, uncovers and carries six coal from six softwood logs without grain", () => {
    const cost = getConstructionCost(27, "roman");
    const { advance, place, simulation } = fixture({ ...STARTER_STOCK,
      logs: 6, grain: 0, planks: cost.planks, stone: cost.stone });
    place(27);
    // Six charcoal field visits and loaded return trips run at the authored carry speed.
    for(let elapsed=0;elapsed<1600 && simulation.headquarters.inventory.coal!==6;elapsed+=10)advance(10);
    expect(simulation.headquarters.inventory.coal).toBe(6);
    expect(simulation.headquarters.inventory.logs ?? 0).toBe(0);
    expect(simulation.headquarters.inventory.grain ?? 0).toBe(0);
    expect(simulation.fieldFrames()[0]?.state).toBe("stubble");
    advance(200);
    expect(simulation.headquarters.inventory.coal).toBe(6);
  });
  it("charburner does not consume wheat or create coal from one log before a pile is complete", () => {
    const cost = getConstructionCost(27, "roman");
    const { advance, place, simulation } = fixture({ ...STARTER_STOCK,
      logs: 1, grain: 7, planks: cost.planks, stone: cost.stone });
    const building = place(27);
    advance(350);
    expect(building.construction).toBe(1);
    expect(building.output.coal ?? 0).toBe(0);
    expect(simulation.headquarters.inventory.coal ?? 0).toBe(0);
    expect(simulation.headquarters.inventory.grain).toBe(7);
    expect(simulation.fieldFrames().some((field) => field.kind === "charcoal" && field.state === "building")).toBe(true);
  });
  it("clears opposing native road-bend traffic without crossing neighboring plots", () => {
    const { world } = fixture();
    const occupied = new Uint8Array(1600);
    for (const [left, top, width, depth] of [[31, 23, 3, 3], [34, 23, 2, 3], [31, 21, 3, 2]])
      for (let z = top!; z < top! + depth!; z++)
        for (let x = left!; x < left! + width!; x++) occupied[z * 40 + x] = 1;
    const tails = [
      [[36, 26], [36, 26.5], [35.5, 26.5], [34, 26.5]],
      [[36, 26], [36, 26.5], [35.5, 26.5], [34, 26.5]],
      [[36.5, 26], [36, 26], [36, 26.5], [35.5, 26.5], [34, 26.5]],
      [[36, 26.5], [36, 26], [36.5, 26], [36.5, 25.5], [36.5, 24.5]]
    ];
    const positions = [[36.185, 26], [36, 25.86], [36.089457, 25.64929], [36, 26.18]];
    const actors = positions.map(([x, z], uid) => ({
      uid, x, z, y: 0, yaw: 0, visible: true, timer: 0, animationTime: 0,
      job: uid === 1 || uid === 2 ? "Carrier" : "Settler", phase: "travelling",
      action: "walk", ware: null, home: 0, building: 0,
      path: tails[uid]!.map(([px, pz]) => ({ x: px!, z: pz! })), pathIndex: uid ? 1 : 0
    })) as SettlementActor[];
    const context = { options: { world, roads: {} }, occupied, actors, buildings: [] } as unknown as SettlementContext;
    for (let frame = 0; frame < 1200 && actors.some((actor) => actor.visible); frame++) {
      for (const actor of actors) {
        if (actor.visible && moveActor(context, actor, 0.05)) actor.visible = false;
        expect(occupied[Math.floor(actor.z) * 40 + Math.floor(actor.x)]).toBe(0);
      }
      const moving = actors.filter((actor) => actor.visible);
      for (let i = 0; i < moving.length; i++)
        for (let j = i + 1; j < moving.length; j++)
          expect(Math.hypot(moving[i]!.x - moving[j]!.x, moving[i]!.z - moving[j]!.z)).toBeGreaterThanOrEqual(actorSeparation(moving[i]!, moving[j]!) - .001);
    }
    expect(actors.every((actor) => !actor.visible)).toBe(true);
  });
  it("keeps moving visible units separated under simultaneous carrier and builder traffic", () => {
    const { place, simulation } = fixture();
    place(17);
    for (let step = 0; step < 2200; step++) {
      simulation.update(0.1);
      const actors = simulation.frames().filter((actor) => actor.visible);
      for (let a = 0; a < actors.length; a++)
        for (let b = a + 1; b < actors.length; b++)
          expect(Math.hypot(actors[a]!.x - actors[b]!.x, actors[a]!.z - actors[b]!.z)).toBeGreaterThanOrEqual(actorSeparation(actors[a]!, actors[b]!) - .001);
    }
    expect(simulation.frames().length).toBeLessThanOrEqual(START_SETTLERS);
  });
});

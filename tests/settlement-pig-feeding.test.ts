import { describe, expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (rotation = 0) => {
  const size = 40;
  const world = { seed: 7, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }, mineZones: [], oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2) } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialStock: {planks:20,stone:20,grain:6,water:6}, stockContact: createIslandStockContacts(world),
    canWorkerEnterPlot: (building, point) => isBuildingCourtyardPointWalkable(building.typeId, building.x,
      building.z, building.rotation, point, building.output, building.input) });
  const placed = simulation.placeBuilding(28, 14, 12, rotation);
  if (!placed.ok) throw new Error(placed.reason);
  let pigfarm = placed.building!;
  pigfarm.construction = 1; pigfarm.required = {}; pigfarm.input = {};
  expect(roads.addRoad(simulation.headquarters.access, pigfarm.access)).toBeTruthy();
  const reload = () => {
    const state = simulation.saveState();
    const next = createSettlementSimulation({ world, roads, initialStock: {planks:20,stone:20,grain:6,water:6}, stockContact: createIslandStockContacts(world),
    canWorkerEnterPlot: (building, point) => isBuildingCourtyardPointWalkable(building.typeId, building.x,
      building.z, building.rotation, point, building.output, building.input) });
    expect(next.loadState(JSON.parse(JSON.stringify(state)))).toEqual({ ok: true });
    expect(next.saveState()).toEqual(state);
    simulation = next; pigfarm = simulation.buildings().find(building => building.uid === pigfarm.uid)!;
  };
  return { get simulation() { return simulation; }, get pigfarm() { return pigfarm; }, world, roads, reload };
};
describe("visible pig breeder paid input loop",()=>{
  it.each([0,1,2,3])("receives front stocks, feeds and pours, conserves six outputs and reloads at rotation %i",rotation=>{
    const f=fixture(rotation);f.simulation.headquarters.accepts.pig=false;
    const phases=new Set<string>(),reloads=new Set<string>(),positions=new Map<number,{x:number;z:number}>();
    for(let tick=0;tick<30000;tick++) {
      f.simulation.update(.05);
      const breeder=f.simulation.frames().find(actor=>actor.job==="Pig breeder");
      if(breeder) {
        phases.add(breeder.phase);
        const previous=positions.get(breeder.uid);
        if(previous&&breeder.visible)expect(Math.hypot(breeder.x-previous.x,breeder.z-previous.z)).toBeLessThan(.07);
        positions.set(breeder.uid,{x:breeder.x,z:breeder.z});
        let state: string | null = null;
        if (breeder.phase==="pigFeedPutdown"&&breeder.wareTransfer!.progress>.4) state=breeder.ware;
        else if (breeder.phase==="work"&&breeder.timer<12) state="breeding";
        if(state&&!reloads.has(state)) {f.reload();reloads.add(state);}
      }
      if(f.pigfarm.output.pig===6)break;
    }
    expect(phases,JSON.stringify(f.simulation.frames())).toContain("pigFeedWalk");
    expect(phases).toContain("pigFeedPutdown");expect(phases).toContain("work");
    expect([...reloads].sort()).toEqual(["breeding","grain","water"]);
    expect(f.pigfarm.output.pig,JSON.stringify({pigfarm:f.pigfarm,actors:f.simulation.frames()})).toBe(6);
    expect(f.pigfarm.input.grain??0).toBe(0);expect(f.pigfarm.input.water??0).toBe(0);
    expect(f.simulation.headquarters.inventory.grain??0).toBe(0);expect(f.simulation.headquarters.inventory.water??0).toBe(0);
    expect(f.pigfarm.cycle).toBe(6);
    for(let tick=0;tick<200;tick++)f.simulation.update(.05);
    expect(f.pigfarm.output.pig).toBe(6);expect(f.pigfarm.cycle).toBe(6);
  });
});

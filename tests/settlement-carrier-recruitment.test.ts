import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (connected: boolean) => {
  const size = 64;
  const world = { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: {x:6,z:6},
    heights: new Float32Array((size+1)**2), blocking: new Uint8Array(size**2),
    walkCost: new Uint8Array(size**2).fill(10), buildClass: new Uint8Array(size**2).fill(BUILD.large),
    props: {count:0,types:new Uint8Array(),x:new Float32Array(),z:new Float32Array()}
  } as unknown as WorldData;
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({world,roads,initialSettlers:100,
    initialStock:{logs:100,planks:100,stone:100},resourceTargets:()=>[]});
  const buildings = [18,28,38].map(x => {
    const [width,depth] = getBuildingDefinition(17).gridFootprint;
    const placed = simulation.placeBuilding(17,x+width%2/2,18+depth%2/2);
    expect(placed.ok,placed.reason).toBe(true);
    const building = placed.building!;
    building.construction=1;building.required={};building.output.logs=6;
    if(connected) expect(simulation.connectRoads(simulation.headquarters.access,building.access)).toBe(true);
    return building;
  });
  const advance = (seconds:number) => {for(let tick=0;tick<seconds*20;tick++)simulation.update(.05);};
  return {simulation,buildings,advance};
};

it("recruits beyond four carriers for reachable waiting outputs without losing settlers",()=>{
  const {advance,simulation} = fixture(true);
  advance(5);
  const carriers = simulation.frames().filter(actor=>actor.job==="Carrier");
  expect(carriers.length).toBeGreaterThan(4);
  expect(carriers.length).toBeLessThanOrEqual(18);
  expect(simulation.snapshot().settlersInside+simulation.frames().filter(actor=>actor.phase!=="retired").length)
    .toBe(100);
  expect(carriers.every(actor=>actor.delivery?.ware==="logs" || actor.phase==="inside" || actor.phase==="home"))
    .toBe(true);
});

it("does not recruit carriers for unreachable output",()=>{
  const {advance,simulation} = fixture(false);
  advance(5);
  expect(simulation.frames().filter(actor=>actor.job==="Carrier")).toHaveLength(0);
  expect(simulation.snapshot().settlersInside).toBe(100);
});

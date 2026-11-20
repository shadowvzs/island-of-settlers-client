import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture=(water:(x:number,z:number)=>number|null= x=>x>=52?-2:null,homeBuilding?:39) => {
  const size=96;
  const world={seed:1,cellsX:size,cellsZ:size,seaLevel:-1,start:{x:20,z:30},
    heights:new Float32Array((size+1)**2),blocking:new Uint8Array(size**2),
    walkCost:new Uint8Array(size**2).fill(10),buildClass:new Uint8Array(size**2).fill(BUILD.large),
    mineZones:[],mineZone:new Uint16Array(size**2),oreAmount:new Uint8Array(size**2),
    props:{count:0,types:new Uint8Array(),x:new Float32Array(),z:new Float32Array(),scale:new Float32Array()}} as unknown as WorldData;
  for(let z=0;z<=size;z++)for(let x=0;x<=size;x++)world.heights[z*(size+1)+x]=water(x,z)??0;
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)if(water(x,z)!==null) {
    const cell=z*size+x;world.walkCost[cell]=0;world.blocking[cell]=1;world.buildClass[cell]=0;
  }
  let simulation:ReturnType<typeof createSettlementSimulation>;
  const roads=createRoadNetwork(world,{isBlocked:(x,z)=>simulation?.isOccupied(x,z)??false});
  simulation=createSettlementSimulation({world,roads,homeBuilding,initialStock:{planks:100,stone:100,hammer:8}});
  return {simulation,world};
};

describe("harbour coastal placement",()=>{
  // GEN-01: the start (20,30) lies ~30 cells from the eastern sea and its centre bearing points the
  // door seawards (rotation 1, still legal there). The plot's own shore must turn its back to the sea.
  it("turns a far colony harbour's back to the sea at its own plot, not the start point's bearing",()=>{
    const {simulation,world}=fixture(undefined,39);
    const home=simulation.home()!;
    expect(Math.hypot(home.x-world.start.x,home.z-world.start.z)).toBeGreaterThan(25);
    expect(home.rotation).toBe(3);
    expect(home.access.x).toBeLessThan(home.x);
  });
  it.each([0,1,2,3])("agrees on preview and authoritative placement beside navigable ocean at rotation %i",rotation=>{
    const {simulation}=fixture();
    expect(simulation.validatePlacement(39,47,35,rotation)).toBeNull();
    expect(simulation.placeBuilding(39,47,35,rotation).ok).toBe(true);
  });
  it("accepts a reachable shore at eight entrance tiles and rejects nine without claiming resources or a foundation",()=>{
    const {simulation}=fixture();
    expect(simulation.validatePlacement(39,46,35,3)).toBeNull();
    const before=simulation.saveState();
    expect(simulation.validatePlacement(39,45,35,3)).toMatch(/within 8 tiles/);
    expect(simulation.placeBuilding(39,45,35,3).reason).toMatch(/within 8 tiles/);
    const after=simulation.saveState();
    expect(after.buildings).toEqual(before.buildings);expect(after.occupied).toEqual(before.occupied);
    expect(after.settlers).toEqual(before.settlers);
  });
  it.each([
    ["shallow ocean",(x:number)=>x>=52?-1.1:null],
    ["enclosed pond",(x:number,z:number)=>x>=52&&x<=85&&z>=20&&z<=85?-2:null],
    ["basin behind a narrow ship-blocking inlet",(x:number,z:number)=>
      z<=15 || (x>=66&&x<=70&&z<=40) || (x>=52&&x<=85&&z>=35&&z<=85)?-2:null]
  ] as const)("rejects %s even when water is nearby",(_name,water)=>{
    const {simulation}=fixture(water);
    expect(simulation.validatePlacement(39,47,50,0)).toMatch(/ocean shore/);
    expect(simulation.placeBuilding(39,47,50,0).ok).toBe(false);
  });
  it("rejects a nearby ocean shore separated by an impassable cliff",()=>{
    const {simulation,world}=fixture();
    for(let z=0;z<world.cellsZ;z++) { const cell=z*world.cellsX+50;world.walkCost[cell]=0;world.blocking[cell]=2; }
    expect(simulation.validatePlacement(39,47,35,0)).toMatch(/ocean shore/);
  });
  it("refreshes ocean and draft masks after terrain edits but loads existing legacy harbours",()=>{
    const {simulation,world}=fixture();
    expect(simulation.validatePlacement(39,47,35,0)).toBeNull();
    expect(simulation.placeBuilding(39,47,35,0).ok).toBe(true);
    const state=simulation.saveState();
    for(let i=0;i<world.heights.length;i++)if(world.heights[i]!<0)world.heights[i]=-1.1;
    world.buildRevision=(world.buildRevision??0)+1;
    expect(simulation.validatePlacement(39,47,50,0)).toMatch(/ocean shore/);
    expect(simulation.loadState(state)).toEqual({ok:true});
    expect(simulation.buildings().some(building=>building.typeId===39)).toBe(true);
  });
});

// Shipyards share authoritative placement checks with the real ship construction/launch search.
describe("shipyard launch placement", () => {
  it.each([0, 1, 2, 3])("accepts a working ocean shore at rotation %i", rotation => {
    const { simulation } = fixture();
    const [width, depth] = getBuildingDefinition(36).gridFootprint;
    const x = 47 + (rotation % 2 ? depth : width) % 2 / 2;
    const z = 35 + (rotation % 2 ? width : depth) % 2 / 2;
    expect(simulation.validatePlacement(36, x, z, rotation)).toBeNull();
    expect(simulation.placeBuilding(36, x, z, rotation).ok).toBe(true);
  });
  it.each([
    ["inland", () => null],
    ["shallow water", (x: number) => x >= 52 ? -1.1 : null],
    ["enclosed pond", (x: number, z: number) => x >= 52 && x <= 85 && z >= 20 && z <= 85 ? -2 : null]
  ] as const)("rejects %s without spending stock or claiming a plot", (_label, water) => {
    const { simulation } = fixture(water);
    const [width, depth] = getBuildingDefinition(36).gridFootprint;
    const x = 47 + width % 2 / 2, z = 35 + depth % 2 / 2;
    const before = simulation.saveState();
    expect(simulation.validatePlacement(36, x, z, 0)).toMatch(/Shipyard needs/);
    expect(simulation.placeBuilding(36, x, z, 0).ok).toBe(false);
    expect(simulation.saveState()).toEqual(before);
  });
});

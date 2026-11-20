import { STARTER_STOCK } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { createIslandStoneDeposits } from "../src/app/settlement/island-stone-deposits";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { rememberIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { ROCK_ROLE, type RockInstance } from "../src/render-common/rocks/rock-instances";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
const fixture = () => ({ seed:9,cellsX:40,cellsZ:40,seaLevel:-1,
  heights:new Float32Array(41**2),blocking:new Uint8Array(1600),walkCost:new Uint8Array(1600).fill(10),
  buildClass:new Uint8Array(1600).fill(BUILD.large),buildCap:new Uint8Array(1600).fill(BUILD.large),slopeClass:new Uint8Array(1600),props:{count:0,types:new Uint8Array(),x:new Float32Array(),z:new Float32Array(),scale:new Float32Array()}
}) as unknown as WorldData;
const rock = (role:RockInstance['role']=ROCK_ROLE.outcrop):RockInstance => ({axes:[[2,0,0],[0,2,0],[0,0,2]],centre:[20,1,20],role,exposure:.5,family:0,high:true,moss:0,slab:1,tint:0,variant:0});
it('gathers finite chunks from the actual visible rock cache without changing its mountain mesh',()=>{
  const world=fixture(),formation=rock(ROCK_ROLE.mass);rememberIslandRocks(world,[formation]);
  const deposits=createIslandStoneDeposits(world,()=>{throw Error('must not remove mountain');});
  const original=JSON.stringify(formation),targets=deposits.targets({x:17,z:20},16);
  expect(targets).toHaveLength(1);const target=targets[0]!;
  expect(target.id).toBeLessThan(0);expect(target.approach!.x).toBeLessThan(19);
  expect(Math.abs(target.approach!.x-formation.centre[0])).toBeGreaterThan(1.4);
  let consumed=0;while(deposits.consume(target))consumed++;
  expect(consumed).toBeGreaterThanOrEqual(6);expect(consumed).toBeLessThanOrEqual(24);
  expect(deposits.targets({x:17,z:20},16)).toEqual([]);expect(JSON.stringify(formation)).toBe(original);
});
it('rejects pebbles, submerged rocks, unreachable shores and deleted visible formations',()=>{
  const world=fixture(),formation=rock();rememberIslandRocks(world,[formation,rock(ROCK_ROLE.pebble)]);
  const deposits=createIslandStoneDeposits(world,()=>{}),target=deposits.targets({x:17,z:20},16)[0]!;
  rememberIslandRocks(world,[]);expect(deposits.consume(target)).toBe(false);
  rememberIslandRocks(world,[formation]);world.walkCost.fill(0);expect(deposits.targets({x:17,z:20},16)).toEqual([]);
  world.walkCost.fill(10);world.seaLevel=1;expect(deposits.targets({x:17,z:20},16)).toEqual([]);
});

it('a real stonemason uses a loose stone boulder as its resource and delivers cut stone home',()=>{
  const world=fixture();world.start={x:5.5,z:5.5};
  world.mineZone=new Uint16Array(1600);world.mineZones=[];
  world.props={...world.props,count:1,types:new Uint8Array([PROP.largeRock]),
    x:new Float32Array([20]),y:new Float32Array([1]),z:new Float32Array([20]),scale:new Float32Array([1])};
  const deposits=createIslandStoneDeposits(world,id=>{
    world.props.types[id]=PROP_REMOVED;world.buildRevision=(world.buildRevision??0)+1;
  });
  expect(deposits.targets({x:14,z:12},24).some(target=>target.id===0)).toBe(true);
  const roads=createRoadNetwork(world);
  const simulation=createSettlementSimulation({world,roads,initialStock:{...STARTER_STOCK},
    resourceTargets:(kind,near,range)=>kind==='stone'?deposits.targets(near,range):undefined,
    consumeResource:target=>target.kind==='stone'?deposits.consume(target):undefined});
  const [width,depth]=getBuildingDefinition(BuildingType.Quarry).gridFootprint;
  const placed=simulation.placeBuilding(BuildingType.Quarry,14+(width%2)/2,12+(depth%2)/2);expect(placed.ok,placed.reason).toBe(true);
  expect(simulation.connectRoads(simulation.headquarters.access,placed.building!.access)).toBe(true);
  const start=simulation.headquarters.inventory.stone??0;
  let carrying=false;
  for(let step=0;step<14000;step++){
    simulation.update(.1);
    if(simulation.frames().some(actor=>actor.job==='Stonemason'&&actor.ware==='stone'))carrying=true;
  }
  expect(carrying).toBe(true);
  expect(simulation.headquarters.inventory.stone).toBeGreaterThan(start);
  expect(deposits.remaining({ id: 0, kind: "stone", x: 20, z: 20 })).toBeLessThan(6);
});

it('a real stonemason quarries visible formation chunks, carries stone home and delivers it to storage',()=>{
  const world=fixture();world.start={x:5.5,z:5.5};
  world.oreAmount=new Uint8Array(1600);world.mineZone=new Uint16Array(1600);world.mineZones=[];
  const formation=rock();rememberIslandRocks(world,[formation]);
  const deposits=createIslandStoneDeposits(world,()=>{});
  const roads=createRoadNetwork(world);
  const simulation=createSettlementSimulation({world,roads,initialStock:{...STARTER_STOCK},
    resourceTargets:(kind,near,range)=>kind==='stone'?deposits.targets(near,range):undefined,
    consumeResource:target=>target.kind==='stone'?deposits.consume(target):undefined});
  const [width,depth]=getBuildingDefinition(BuildingType.Quarry).gridFootprint;
  const placed=simulation.placeBuilding(BuildingType.Quarry,14+(width%2)/2,12+(depth%2)/2);expect(placed.ok,placed.reason).toBe(true);
  const building=placed.building!;expect(simulation.connectRoads(simulation.headquarters.access,building.access)).toBe(true);
  let carrying=false;for(let step=0;step<14000;step++){
    simulation.update(.1);if(simulation.frames().some(actor=>actor.job==='Stonemason'&&actor.ware==='stone'))carrying=true;
  }
  expect(carrying).toBe(true);expect(simulation.headquarters.inventory.stone).toBeGreaterThan(STARTER_STOCK.stone!);
  expect(formation.centre).toEqual([20,1,20]);
});
it('consumes an already selected mountain target after loading its ledger',()=>{
  const world=fixture();
  for(let z=0;z<=40;z++)for(let x=19;x<=24;x++)world.heights[z*41+x]=Math.min(8,(x-18)**1.4);
  const deposits=createIslandStoneDeposits(world,()=>{});
  const target=deposits.targets({x:17,z:20},16).find(entry=>entry.id<=-1_000_000)!;
  expect(target).toBeDefined();expect(deposits.consume(target)).toBe(true);
  const restored=createIslandStoneDeposits(world,()=>{},deposits.saveState());
  expect(restored.consume(target)).toBe(true);
  expect(restored.remaining(target)).toBe(10);
});

it('quarries an exposed mountain foot with a dry lower approach without flattening the mountain',()=>{
  const world=fixture();
  for(let z=0;z<=40;z++)for(let x=19;x<=24;x++)world.heights[z*41+x]=Math.min(8,(x-18)**1.4);
  const original=world.heights.slice(),deposits=createIslandStoneDeposits(world,()=>{});
  const target=deposits.targets({x:17,z:20},16).find(target=>target.id<=-1_000_000);
  expect(target).toBeDefined();expect(target!.approach!.x).toBeLessThan(target!.x);
  for(let i=0;i<12;i++)expect(deposits.consume(target!)).toBe(true);
  expect(deposits.consume(target!)).toBe(false);expect(world.heights).toEqual(original);
});

it("exhausting a stone beside a graded road never changes terrain or its grading source", async () => {
  const { levelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const { PROP, PROP_REMOVED } = await import("../src/shared/world/world-data");
  const world = fixture();
  world.props = { ...world.props, count: 1, types: new Uint8Array([PROP.largeRock]),
    x: new Float32Array([20]), z: new Float32Array([20]), scale: new Float32Array([1]) };
  const roads = [{ start: { x: 17, z: 20 }, end: { x: 17.5, z: 20 }, tier: "stone" as const }];
  levelRoadGround(world, roads, []);
  const heights = world.heights.slice(), reference = world.roadGradeBase!.slice();
  const deposits = createIslandStoneDeposits(world, id => {
    world.props.types[id] = PROP_REMOVED;
    world.buildRevision = (world.buildRevision ?? 0) + 1;
  });
  const target = deposits.targets({ x: 17, z: 20 }, 6).find(entry => entry.id === 0)!;
  expect(target).toBeDefined();
  for (let count = 0; count < 6; count++) expect(deposits.consume(target)).toBe(true);
  expect(deposits.consume(target)).toBe(false);
  expect(world.heights).toEqual(heights);
  expect(world.roadGradeBase).toEqual(reference);
  expect(levelRoadGround(world, roads, [])).toBeNull();
  expect(world.heights).toEqual(heights);
});
it('invalidates an already selected quarry target as soon as a road covers its boulder', async () => {
  const { updateSettlementGroundClearance } = await import('../src/shared/settlement/settlement-ground-clearance');
  const world = fixture(), formation = rock(); rememberIslandRocks(world, [formation]);
  const deposits = createIslandStoneDeposits(world, () => {});
  const target = deposits.targets({ x: 17, z: 20 }, 16)[0]!;
  expect(target).toBeDefined();
  updateSettlementGroundClearance(world, [{ start: { x: 18, z: 20 }, end: { x: 22, z: 20 }, tier: 'dirt' }], []);
  expect(deposits.targets({ x: 17, z: 20 }, 16)).toEqual([]);
  expect(deposits.consume(target)).toBe(false);
  updateSettlementGroundClearance(world, [], []);
  rememberIslandRocks(world, [formation]);
  expect(deposits.targets({ x: 17, z: 20 }, 16)).toEqual([]);
});
it('removes cached hidden mountain targets beneath a completed building without deforming heights', async () => {
  const { updateSettlementGroundClearance } = await import('../src/shared/settlement/settlement-ground-clearance');
  const world = fixture();
  for (let z = 0; z <= 40; z++) for (let x = 19; x <= 24; x++) world.heights[z * 41 + x] = Math.min(8, (x - 18) ** 1.4);
  const heights = world.heights.slice(), deposits = createIslandStoneDeposits(world, () => {});
  const target = deposits.targets({ x: 17, z: 20 }, 16).find(target => target.id <= -1_000_000)!;
  expect(target).toBeDefined();
  updateSettlementGroundClearance(world, [], [{ x: target.x, z: target.z, width: 4, depth: 4 } as any]);
  expect(deposits.targets({ x: 17, z: 20 }, 16).some(entry => entry.id === target.id)).toBe(false);
  expect(deposits.consume(target)).toBe(false);
  expect(world.heights).toEqual(heights);
});

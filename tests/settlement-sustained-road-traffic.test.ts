import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it("keeps a100-settler three-workshop economy delivering for240seconds beside an idle public-road obstruction",()=>{
 const size=64,world={seed:3,cellsX:size,cellsZ:size,seaLevel:-1,start:{x:6,z:6},
  heights:new Float32Array((size+1)**2),blocking:new Uint8Array(size**2),walkCost:new Uint8Array(size**2).fill(10),
  buildClass:new Uint8Array(size**2).fill(BUILD.large),oreAmount:new Uint8Array(size**2),mineZone:new Uint16Array(size**2),mineZones:[],
  props:{count:0,types:new Uint8Array(),x:new Float32Array(),z:new Float32Array()}} as unknown as WorldData;
 const roads=createRoadNetwork(world);
 const simulation=createSettlementSimulation({world,roads,initialSettlers:100,
  initialStock:{logs:100,planks:100,stone:100,iron:100,grain:100,hammer:6,axe:2,saw:2,tongs:2},
  resourceTargets:()=>[],
  canWorkerEnterPlot:(building,point)=>isBuildingCourtyardPointWalkable(building.typeId,building.x,building.z,building.rotation,point,building.output,building.input),
  stockContact:(building,kind,ware,slot)=>{
   const contact=getBuildingStockContact(building.typeId,kind,ware,slot,building.x,building.z,building.rotation,building.y,kind==="input"?building.input:building.output,kind==="input"?building.output:building.input);
   return contact && {ware,slot,stock:{x:contact.warePosition[0],y:contact.warePosition[1],z:contact.warePosition[2]},
    approach:{x:contact.approach[0],y:contact.approach[1],z:contact.approach[2]},yaw:contact.wareYaw,scale3:{x:contact.wareScale[0],y:contact.wareScale[1],z:contact.wareScale[2]}};
  }});
 const buildings=[[33,20,12],[25,28,12],[31,20,23],[17,28,23]].map(([id,x,z])=>{
  const [width,depth]=getBuildingDefinition(id!).gridFootprint;
  const placed=simulation.placeBuilding(id!,x!+width%2/2,z!+depth%2/2);
  expect(placed.ok,placed.reason).toBe(true);const building=placed.building!;
  building.construction=1;building.required={};
  expect(simulation.connectRoads(simulation.headquarters.access,building.access)).toBe(true);
  return building;
 });
 buildings[1]!.selectedOutput="hammer";
 const history:unknown[]=[];let historyKey="",elapsed=0;
 const advance=(seconds:number)=>{for(let tick=0;tick<seconds*20;tick++){
  simulation.update(.05);elapsed+=.05;const worker=simulation.frames().find(a=>a.uid===buildings[1]!.worker);
  const state={phase:worker?.phase,ware:worker?.ware,output:buildings[1]!.output,hammer:simulation.headquarters.inventory.hammer};const key=JSON.stringify(state);
  if(key!==historyKey){history.push({time:elapsed,state:JSON.parse(key)});historyKey=key;}
 }};
 advance(210);
 const blocker=simulation.frames().find(actor=>actor.job==="Woodcutter")!;
 expect(blocker).toBeDefined();
 const route=roads.route(simulation.headquarters.access,buildings[0]!.access)!;
 const position=route.points.slice(4,-4).find(point=>simulation.frames().every(actor=>!actor.visible ||
  Math.hypot(actor.x-point.x,actor.z-point.z)>.5))!;
 expect(position).toBeDefined();Object.assign(blocker,position);
 blocker.visible=true;blocker.action="idle";blocker.phase="inside";blocker.path=[];blocker.pathIndex=0;
 const initial={x:blocker.x,z:blocker.z};
 let previousFlour=simulation.headquarters.inventory.flour??0;
 let previousHammers=simulation.headquarters.inventory.hammer??0;
 for(let window=0;window<2;window++){
  advance(120);
  const flour=simulation.headquarters.inventory.flour??0,hammers=simulation.headquarters.inventory.hammer??0;
  expect(flour,`flour deliveries in two-minute window${window+1}: ${JSON.stringify({buildings:buildings.map(b=>({id:b.typeId,input:b.input,output:b.output,status:b.status,worker:b.worker})),history,inventory:simulation.headquarters.inventory,actors:simulation.frames().map(a=>({id:a.uid,job:a.job,phase:a.phase,x:a.x,z:a.z,goal:a.path[a.pathIndex],queue:a.queueTarget,ware:a.ware}))})}`).toBeGreaterThan(previousFlour);
  expect(hammers,`tool deliveries in two-minute window${window+1}: ${JSON.stringify({buildings:buildings.map(b=>({id:b.typeId,input:b.input,output:b.output,status:b.status,worker:b.worker})),history,inventory:simulation.headquarters.inventory,actors:simulation.frames().map(a=>({id:a.uid,job:a.job,phase:a.phase,x:a.x,z:a.z,goal:a.path[a.pathIndex],queue:a.queueTarget,ware:a.ware}))})}`).toBeGreaterThan(previousHammers);
  previousFlour=flour;previousHammers=hammers;
 }
 // Passers walk around an idle worker; only idle travellers between errands are pushed aside.
 expect(Math.hypot(blocker.x-initial.x,blocker.z-initial.z)).toBeLessThan(.05);
 expect(blocker.tool).toBe("axe");expect(blocker.ware).toBeNull();
 expect(simulation.snapshot().settlersInside+simulation.frames().filter(actor=>actor.phase!=="retired").length).toBe(100 + simulation.settlerBirths());
},15000);

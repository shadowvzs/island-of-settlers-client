import {STARTER_STOCK} from '@shared/catalog/balance';
import {expect,it} from 'vitest';

import {getBuildingDefinition} from '../src/render-common/buildings/building-catalog';
import {isBuildingCourtyardPointWalkable} from '../src/render-common/buildings/building-courtyard';
import {getBuildingStockContact} from '../src/render-common/buildings/building-stock-anchors';
import {createRoadNetwork} from '../src/shared/settlement/road-network';
import {createSettlementSimulation} from '../src/shared/settlement/settlement-simulation';
import {BLOCKING,BUILD,PROP,PROP_REMOVED,type WorldData} from '../src/shared/world/world-data';

it('drains actual exterior stock and entrance traffic for three neighboring producers with100 settlers and conserves every ware',()=>{
 const size=48,world={seed:9,cellsX:size,cellsZ:size,seaLevel:-1,start:{x:5.5,z:5.5},
  heights:new Float32Array(49**2),blocking:new Uint8Array(size**2),walkCost:new Uint8Array(size**2).fill(10),buildClass:new Uint8Array(size**2).fill(BUILD.large),
  oreAmount:new Uint8Array(size**2),mineZone:new Uint16Array(size**2),mineZones:[],
  props:{count:6,types:new Uint8Array(6).fill(PROP.broadleafTree),scale:new Float32Array(6).fill(1),x:new Float32Array([27,29,31,27,29,31]),z:new Float32Array([7,7,7,10,10,10])}} as unknown as WorldData;
 for(let z=16;z<23;z++)for(let x=30;x<36;x++){world.blocking[z*size+x]=BLOCKING.water;world.walkCost[z*size+x]=0;}
 // As in the game (island-settlement.ts), roads never cross an occupied building plot.
 let simulation:ReturnType<typeof createSettlementSimulation>|undefined;
 const roads=createRoadNetwork(world,{isBlocked:(x,z)=>simulation?.isOccupied(x,z)??false}),produced={logs:0,fish:0,stone:0};
 simulation=createSettlementSimulation({world,roads,initialSettlers:100,initialStock:{...STARTER_STOCK},
  canWorkerEnterPlot:(building,point)=>isBuildingCourtyardPointWalkable(building.typeId,building.x,building.z,building.rotation,point,building.output,building.input),
  stockContact:(building,kind,ware,slot)=>{
   const contact=getBuildingStockContact(building.typeId,kind,ware,slot,building.x,building.z,building.rotation,building.y,kind==="input"?building.input:building.output,kind==="input"?building.output:building.input);
   if(!contact)return null;return{ware,slot,stock:{x:contact.warePosition[0],y:contact.warePosition[1],z:contact.warePosition[2]},approach:{x:contact.approach[0],y:contact.approach[1],z:contact.approach[2]},yaw:contact.wareYaw,scale3:{x:contact.wareScale[0],y:contact.wareScale[1],z:contact.wareScale[2]}};
  },resourceTargets:(kind)=>{
   if(kind==='stone'&&produced.stone<6)return[{id:-1,kind:'stone',x:28,z:25,approach:{x:27.2,z:25}}];
   if(kind==='fish'&&produced.fish<6)return[{id:-2,kind:'fish',x:30,z:17,y:0,approach:{x:29,z:17}}];
   return kind==='fish'||kind==='stone'?[]:undefined;
  },
  consumeResource:target=>{if(target.kind==='tree'){world.props.types[target.id]=PROP_REMOVED;produced.logs++;return true;}if(target.kind==='fish'){produced.fish++;return true;}if(target.kind==='stone'){produced.stone++;return true;}return undefined;}});
 // Plots keep every flag and road's reserved stone width clear: all three are placed before the roads.
 const locations:[[number,number,number],[number,number,number],[number,number,number]]=[[17,18,15],[18,23,15],[19,18,22]];
 const buildings=locations.map(([id,x,z])=>{const [width,depth]=getBuildingDefinition(id).gridFootprint;const result=simulation.placeBuilding(id,x+(width%2)/2,z+(depth%2)/2);expect(result.ok,result.reason).toBe(true);return result.building!;});
 for(const building of buildings)expect(simulation.connectRoads(simulation.headquarters.access,building.access),String(building.typeId)+JSON.stringify(building.access)).toBe(true);
 let simultaneous=0;
 for(let step=0;step<9000;step++){
  simulation.update(.1);simultaneous=Math.max(simultaneous,simulation.frames().filter(actor=>actor.visible && actor.job==='Carrier').length);
 }

 expect(buildings.every(building=>building.construction===1),JSON.stringify(buildings.map(b=>({id:b.typeId,progress:b.construction,status:b.status,input:b.input,incoming:b.incoming,worker:simulation.frames().find(a=>a.uid===b.worker)})))).toBe(true);expect(simultaneous).toBeGreaterThanOrEqual(3);
 for(const ware of ['logs','fish','stone'] as const){expect(produced[ware],ware).toBe(6);const remaining=simulation.frames().filter(actor=>actor.ware===ware).length+buildings.reduce((sum,b)=>sum+(b.output[ware]??0),0);expect(remaining).toBe(0);}
 expect(simulation.headquarters.inventory.logs).toBe((STARTER_STOCK.logs??0)+6);
 expect(simulation.headquarters.inventory.fish).toBe((STARTER_STOCK.fish??0)+6);

 expect(simulation.snapshot().settlersInside+simulation.frames().filter(actor=>actor.phase!=="retired").length).toBe(100 + simulation.settlerBirths());
},15000);

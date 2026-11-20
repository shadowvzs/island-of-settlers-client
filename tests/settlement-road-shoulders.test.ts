import { expect, it } from "vitest";

import { moveActor } from "../src/shared/settlement/settlement-paths";
import { updateStationaryRoadYield } from "../src/shared/settlement/settlement-road-shoulders";
import {
  actorSeparation, isShoveableIdler, requestStationaryRoadYield
} from "../src/shared/settlement/settlement-traffic";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const fixture = () => {
  const size=32;
  const context={buildings:[],actors:[],occupied:new Uint8Array(size**2),options:{
    world:{cellsX:size,cellsZ:size,heights:new Float32Array((size+1)**2),blocking:new Uint8Array(size**2),
      walkCost:new Uint8Array(size**2).fill(10),props:{count:0}},
    roads:{segments:()=>[{start:{x:3,z:10},end:{x:27,z:10}}],speedAt:()=>1}
  }} as unknown as SettlementContext;
  const blocker={uid:0,x:15,z:10,y:0,yaw:0,visible:true,job:"Woodcutter",phase:"inside",action:"idle",
    path:[],pathIndex:0,timer:11,animationTime:0,home:0,building:1,ware:"logs",tool:"axe"} as SettlementActor;
  context.actors.push(blocker);
  return{context,blocker};
};
it("six opposing loaded carriers sidestep an idle outdoor worker on a public lane; the worker keeps its spot",()=>{
  const {blocker,context}=fixture();
  const carriers=Array.from({length:6},(_,index)=>({uid:index+1,x:index<3?11-index*.5:19+(index-3)*.5,z:10,y:0,yaw:0,
    visible:true,job:"Carrier",phase:"deliver",action:"carry",ware:index%2?"stone":"planks",home:0,building:1,
    path:[{x:index<3?24:6,z:10}],pathIndex:0,timer:0,animationTime:0} as SettlementActor));
  context.actors.push(...carriers);
  const completed=new Set<number>();
  for(let tick=0;tick<800 && completed.size<6;tick++) {
    const before={x:blocker.x,z:blocker.z};
    updateStationaryRoadYield(context,blocker,.05);
    expect(Math.hypot(blocker.x-before.x,blocker.z-before.z)).toBeLessThanOrEqual(.045001);
    for(const carrier of carriers) if(!completed.has(carrier.uid) && moveActor(context,carrier,.05)) { completed.add(carrier.uid); carrier.visible=false; }
    for(const carrier of carriers)expect(Math.hypot(carrier.x-blocker.x,carrier.z-blocker.z)).toBeGreaterThanOrEqual(actorSeparation(carrier,blocker)-1e-6);
    const visible=context.actors.filter(actor=>actor.visible);
    for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++)
      expect(Math.hypot(visible[i]!.x-visible[j]!.x,visible[i]!.z-visible[j]!.z)).toBeGreaterThanOrEqual(actorSeparation(visible[i]!,visible[j]!)-1e-6);
  }
  expect(completed.size).toBe(6);
  expect(blocker.x).toBe(15);expect(blocker.z).toBe(10);
  expect(blocker.phase).toBe("inside");expect(blocker.timer).toBe(11);
  expect(blocker.ware).toBe("logs");expect(blocker.tool).toBe("axe");
  expect(carriers.every(carrier=>carrier.ware!==null)).toBe(true);
});
it("does not pull working, building, leveling, resting or handoff crews away from their spot",()=>{
 const {blocker,context}=fixture();const passing={...blocker,uid:1,x:12,ware:null} as SettlementActor;
 for(const phase of ["construct","work","outputPutdown","inputPickup","fishWait","builderWork","levelWaiting",
   "workerRestWait","inputFetchBlocked","inputReturnBlocked","deposit"]){
  blocker.phase=phase;
  expect(requestStationaryRoadYield(context,blocker,passing,{x:20,z:10})).toBe(false);
 }
});
it("an unburdened idle worker clears the road, but a worker with a pending job does not", () => {
  const passing = { ...fixture().blocker, uid: 1, x: 12, ware: null } as SettlementActor;
  const idle = fixture();
  Object.assign(idle.blocker, { job: "Builder", phase: "home", ware: null, tool: undefined });
  expect(isShoveableIdler(idle.blocker)).toBe(true);
  expect(requestStationaryRoadYield(idle.context, idle.blocker, passing, { x: 20, z: 10 })).toBe(true);

  const pending = fixture();
  Object.assign(pending.blocker, { job: "Builder", phase: "home", ware: null, tool: undefined,
    delivery: { source: 1, destination: 1, ware: "planks" } });
  expect(isShoveableIdler(pending.blocker)).toBe(false);
  expect(requestStationaryRoadYield(pending.context, pending.blocker, passing, { x: 20, z: 10 })).toBe(false);
});

it("only carriers are pushed aside: arrived workers, builders and soldiers keep their spot (owner 2026-10-15)", () => {
  const passing = { ...fixture().blocker, uid: 1, x: 12, ware: null } as SettlementActor;
  for (const phase of ["deliver", "home", "pickup", "retire", "returnWork"]) {
    for (const job of ["Settler", "Woodcutter", "Builder", "Soldier"]) {
      const { blocker, context } = fixture();
      Object.assign(blocker, { job, phase });
      expect(isShoveableIdler(blocker)).toBe(false);
      expect(requestStationaryRoadYield(context, blocker, passing, { x: 20, z: 10 })).toBe(false);
    }
    for (const job of ["Carrier", "Mount"]) {
      const { blocker, context } = fixture();
      Object.assign(blocker, { job, phase });
      expect(requestStationaryRoadYield(context, blocker, passing, { x: 20, z: 10 })).toBe(true);
    }
  }
});
it("keeps the separate military rule: an idle field soldier steps aside, one mid-blow does not", () => {
  const { blocker } = fixture();
  Object.assign(blocker, { job: "Soldier", phase: "militaryField" });
  expect(isShoveableIdler(blocker)).toBe(true);
  blocker.action = "work";
  expect(isShoveableIdler(blocker)).toBe(false);
});
it("reserves distinct shoulder goals and refuses unsafe terrain instead of pushing an idle carrier into water",()=>{
 const {blocker,context}=fixture();
 Object.assign(blocker,{job:"Carrier",phase:"home"});
 const second={...blocker,uid:2,x:blocker.x+.25};context.actors.push(second);
 const passing={...blocker,uid:3,x:12,ware:null} as SettlementActor;
 expect(requestStationaryRoadYield(context,blocker,passing,{x:20,z:10})).toBe(true);
 expect(requestStationaryRoadYield(context,second,passing,{x:20,z:10})).toBe(true);
 expect(Math.hypot(blocker.queueTarget!.x-second.queueTarget!.x,blocker.queueTarget!.z-second.queueTarget!.z)).toBeGreaterThanOrEqual(actorSeparation(blocker,second)+.1);
 const unsafe=fixture();unsafe.context.options.world.walkCost.fill(0);
 Object.assign(unsafe.blocker,{job:"Carrier",phase:"home"});
 expect(requestStationaryRoadYield(unsafe.context,unsafe.blocker,passing,{x:20,z:10})).toBe(false);
 expect(unsafe.blocker.queueTarget).toBeUndefined();expect(unsafe.blocker.x).toBe(15);expect(unsafe.blocker.z).toBe(10);
});
it("a pushed idle carrier walks back to its spot once the road beside it is quiet",()=>{
 const {blocker,context}=fixture();
 Object.assign(blocker,{job:"Carrier",phase:"home",yaw:1.1});
 const passing={...blocker,uid:3,x:12,ware:null} as SettlementActor;
 expect(requestStationaryRoadYield(context,blocker,passing,{x:20,z:10})).toBe(true);
 for(let tick=0;tick<200;tick++)updateStationaryRoadYield(context,blocker,.05);
 expect(Math.hypot(blocker.x-15,blocker.z-10)).toBeLessThan(.2);
 expect(Math.abs(blocker.yaw-1.1)).toBeLessThan(.1);
 expect(blocker.queueTarget).toBeUndefined();expect(blocker.timer).toBe(11);
});

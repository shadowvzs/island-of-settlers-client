import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { DMath } from "../math/deterministic-math";
import {groundPath,moveActor,setActorPath} from "./settlement-paths";
import {advanceWareTransfer,clearWareTransfer,startWareTransfer} from "./settlement-stock-transfers";
import type {SettlementActor,SettlementBuilding,SettlementContext} from "./settlement-types";
const pigWorldPoint=(building:SettlementBuilding,x:number,z:number)=>{
  const scale=requireBuildingGeometry(28).plot.scale,a=building.rotation*Math.PI/2;
  return {x:building.x+(x*DMath.cos(a)+z*DMath.sin(a))*scale,z:building.z+(-x*DMath.sin(a)+z*DMath.cos(a))*scale};
};
const pigFeedWorkPoint=(building:SettlementBuilding,ware:string)=>pigWorldPoint(building,ware==="water"?1.53:.65,ware==="water"?.68:1.02);
/** The picked ware is already counted in actor.consumed; feeding never spends it a second time. */
export const routePigInputToPen=(context:SettlementContext,actor:SettlementActor,building:SettlementBuilding)=>{
  const point=pigFeedWorkPoint(building,actor.ware??"grain"),path=groundPath(context,actor,point,building.uid);
  if(path)setActorPath(actor,path,"pigFeedWalk");
  else {actor.phase="pigFeedBlocked";actor.action="idle";actor.timer=1;building.status="Waiting for clear pig feeding access";}
};
export const startPigProduction=(actor:SettlementActor,building:SettlementBuilding)=>{
  if(building.typeId!==28)return false;
  actor.phase="work";actor.action="work";actor.timer=24;actor.productionInputs=undefined;
  building.workTime=0;building.pigFeedPhase="breeding";building.working=true;building.status="Pigs feeding and growing";
  return true;
};
export const updatePigBreeder=(context:SettlementContext,actor:SettlementActor,building:SettlementBuilding,dt:number,nextInput:()=>void)=>{
  if(building.typeId!==28)return false;
  if(actor.phase==="work") {building.workTime=Math.max(0,24-actor.timer);return false;}
  if(actor.phase==="pigFeedBlocked") {actor.timer-=dt;if(actor.timer<=0)routePigInputToPen(context,actor,building);return true;}
  if(actor.phase==="pigFeedWalk") {
    if(!moveActor(context,actor,dt))return true;
    const ware=actor.ware!,point=pigWorldPoint(building,ware==="water"?1:.65,.68);
    const scale=requireBuildingGeometry(28).plot.scale;
    startWareTransfer(actor,"putdown",ware,{ware,slot:0,approach:{...actor},stock:{...point,y:building.y+.102*scale+(ware==="water"?.32:0)},scale3:actor.wareScale,yaw:building.rotation*Math.PI/2});
    if(ware==="water")actor.wareTransfer!.pour=true;
    actor.phase="pigFeedPutdown";building.pigFeedPhase=ware==="water"?"water":"grain";
    building.workTime=0;building.working=true;building.status=ware==="water"?"Pouring water for pigs":"Feeding wheat to pigs";return true;
  }
  if(actor.phase==="pigFeedPutdown") {
    building.workTime=actor.wareTransfer?.progress??0;
    if(!advanceWareTransfer(actor,dt*(actor.ware==="water"?.35:1)))return true;
    // Feed delivered to animals is spent, while any still-carried input remains recoverable.
    if(actor.ware && actor.consumed) delete actor.consumed[actor.ware];
    clearWareTransfer(actor);actor.ware=null;actor.wareScale=undefined;actor.productionInputs?.shift();nextInput();return true;
  }
  return false;
};

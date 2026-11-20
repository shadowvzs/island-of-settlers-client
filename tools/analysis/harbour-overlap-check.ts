import { readFile } from "node:fs/promises";
import { createSnapshotSession } from "./snapshot-session";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
const save=JSON.parse(await readFile(process.argv[2]!,"utf8")) as GameSaveV1;
const session=await createSnapshotSession(save,{elapsed:0});
const sim=session.simulation;
const harbour=sim.buildings().find(b=>b.typeId===39 && b.construction===1)!;
const snap=(t:number)=>{
 const q=sim.doorQueueSnapshot(harbour.uid);
 const inDoor=q.actors.filter(a=>a.visible && a.inPassage).map(a=>{
   const actor=sim.frames().find(f=>f.uid===a.uid)!;
   return {uid:a.uid,phase:a.phase,x:+actor.x.toFixed(2),z:+actor.z.toFixed(2),visible:a.visible,pathIndex:actor.pathIndex};
 });
 console.log(JSON.stringify({t,owner:q.owner,n:q.actors.length,inDoor}));
};
snap(0);
let overlaps=0;
for(let t=1;t<=600;t++){
 sim.update(1);
 const q=sim.doorQueueSnapshot(harbour.uid);
 const rows=q.actors.filter(a=>a.visible && a.inPassage);
 const exits=rows.filter(a=>a.phase==="exitLoaded"||a.phase==="exitDelivery").length;
 if(rows.length>1 && exits>0 && exits<rows.length){ overlaps++; if(overlaps<6) console.log("OPPOSING",t,rows.map(a=>({uid:a.uid,phase:a.phase}))); }
 if([30,60,120,300,600].includes(t)) snap(t);
}
console.log("opposing samples",overlaps);
console.log('final ticks',sim.tickCount());

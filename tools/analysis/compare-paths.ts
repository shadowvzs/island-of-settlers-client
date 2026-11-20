import { readFile } from "node:fs/promises";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
const s=JSON.parse(await readFile(process.argv[2]!,"utf8")) as GameSaveV1;
const run=async(x:GameSaveV1,n:number)=>advanceOfflineGame(structuredClone(x),x.savedAt+n*1000,()=>{},{exact:true,eventCore:false});
const mid=await run(s,30), cont=await run(s,60);
const a=mid.settlement.actors.find(a=>a.uid===583)!, c=cont.settlement.actors.find(a=>a.uid===583)!;
const key=(p:any)=>`${p.x.toFixed(3)},${p.z.toFixed(3)}`;
const midKeys=a.path.map(key), contKeys=c.path.map(key);
let cursor=0; const mapping:any[]=[];
for(const [i,k] of contKeys.entries()){
 let idx=-1; for(let j=cursor;j<midKeys.length;j++) if(midKeys[j]===k){idx=j;break;}
 mapping.push({i,idx,key:k}); if(idx>=0)cursor=idx+1;
}
console.log(JSON.stringify({mid:{len:a.path.length,idx:a.pathIndex,first:a.path.slice(0,3),last:a.path.slice(-3)},cont:{len:c.path.length,idx:c.pathIndex,first:c.path.slice(0,3),last:c.path.slice(-3)},sample:mapping.slice(0,20),missing:mapping.filter(x=>x.idx<0).length,lastMappings:mapping.slice(-5)},null,1));

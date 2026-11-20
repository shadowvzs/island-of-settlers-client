import { readFileSync } from "node:fs";
import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
let save=JSON.parse(readFileSync(process.argv[2]!,"utf8")) as GameSaveV1;
for (let i=0;i<12;i++){
  save=await advanceOfflineGame(structuredClone(save), save.savedAt+300_000, ()=>{}, {});
  try { await stageGameSession(save); }
  catch(e){ console.log('STAGE FAIL chunk',i+1,e);
    const t=save.settlement.storageTraffic; const ids=new Set(save.settlement.actors.map(a=>a.uid));
    console.log('actors',save.settlement.actors.length,'traffic',t?.actors?.filter(x=>!ids.has(x.actor)),'owners',t?.owners?.filter(x=>!ids.has(x.actor)),'departures',t?.departures?.filter(x=>!ids.has(x.actor))); process.exit(1); }
  console.log('chunk',i+1,'ok',save.savedAt);
}

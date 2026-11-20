import { readFile } from "node:fs/promises";
import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { prepareRoadPath, ROAD_TRAVEL_LANE } from "../../src/shared/settlement/settlement-road-travel";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";
const s=JSON.parse(await readFile(process.argv[2]!,"utf8")) as GameSaveV1;
const mid=await advanceOfflineGame(structuredClone(s),s.savedAt+30_000,()=>{},{exact:true,eventCore:false});
const lm=await stageGameSession(mid); const a=lm.settlement.actors.find(a=>a.uid===583)!;
const roads=createRoadNetwork(lm.map.world);
const context={options:{world:lm.map.world,roads},buildings:lm.settlement.buildings,actors:lm.settlement.actors,
 fieldCycles:{isOccupied:()=>false},occupied:savedOccupancy(lm.settlement).slice(),reservations:new Set(lm.settlement.reservations),
 playerNation:lm.settlement.playerNation} as unknown as SettlementContext;
const copy=structuredClone(a);
try { prepareRoadPath(context,copy,ROAD_TRAVEL_LANE); console.log('prepared',copy.path.length,copy.path.slice(0,2),copy.path.slice(-2)); }
catch(e){ console.log('error',String(e)); }

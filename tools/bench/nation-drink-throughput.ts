import { STARTER_STOCK } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { NATION_DRINK_CHAINS } from "../../src/shared/settlement/nation-drinks";
import { createBalanceSimulation, placeFinished } from "./garrison-balance-harness";
import { resourcesPath } from "./resources-path";

const reports=[];
for(const nation of ["roman","viking","japanese","nubian"] as WorkerNation[]) {
  const sim=createBalanceSimulation(64,19);
  sim.setPlayerNation(nation);
  const saved=sim.saveState();saved.settlers=100;
  const hq=saved.buildings.find(b=>b.typeId===0)!;hq.idleSettlers=100;
  hq.inventory={...STARTER_STOCK,planks:200,stone:200,water:1000};
  assert(sim.loadState(saved).ok);
  const grower=placeFinished(sim,5,17,10),maker=placeFinished(sim,6,17,18);
  for(const site of [grower,maker]) assert(sim.connectRoads(sim.headquarters.access,site.access));
  const {drink,raw}=NATION_DRINK_CHAINS[nation];
  const samples=[];
  for(let tick=1;tick<=36000;tick++) {
    sim.update(.1);
    if(tick%6000===0) {
      const state=sim.saveState(),sites=state.buildings;
      samples.push({seconds:tick/10,
        raw:sites.reduce((sum,b)=>sum+(b.inventory[raw]??0)+(b.output[raw]??0)+(b.input[raw]??0),0),
        drinks:sites.reduce((sum,b)=>sum+(b.inventory[drink]??0)+(b.output[drink]??0)+(b.input[drink]??0),0),
        grower:grower.status,maker:maker.status});
    }
  }
  reports.push({nation,samples});console.log(JSON.stringify({nation,samples}));
}
const out=resourcesPath("project-reviews","codex-2026-10-15","drink-throughput");mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,"comparison.json"),JSON.stringify(reports,null,2));

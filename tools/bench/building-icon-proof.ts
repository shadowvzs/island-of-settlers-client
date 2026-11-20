import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { nationalBuildingIconPath } from "../../src/render-common/buildings/building-icon-path";
import type { WorkerNation } from "../../src/render-common/workers/worker-nation";
import { buildingAssetCodes } from "./building-asset-targets";

export interface BuildingIconRenderProof { id: number; nation: string; nodeName: string; triangles: number }

/** Full canonical sets only: each PNG is bound to the actual native model metadata and its bytes. */
export const writeBuildingIconProof = (nation: WorkerNation, rows: BuildingIconRenderProof[]) => {
  assert.deepEqual(rows.map(row => row.id).sort((a,b)=>a-b),buildingAssetCodes());
  const icons=[...rows].sort((first,second)=>first.id-second.id).map(row=>{
    assert.equal(row.nation,nation,"Do not export a Roman fallback as another nation's icon");
    assert(row.triangles>0,"Do not accept an empty icon model");
    const path=nationalBuildingIconPath(nation,row.id),bytes=readFileSync(path);
    assert.equal(bytes.readUInt32BE(16),240);assert.equal(bytes.readUInt32BE(20),180);
    return {...row,path,sha256:createHash("sha256").update(bytes).digest("hex"),quality:"high",level:1};
  });
  const folder=resolve(`assets/buildings/${nation}`);mkdirSync(folder,{recursive:true});
  writeFileSync(resolve(folder,"building-icon-proof.json"),JSON.stringify({nation,generatedAt:new Date().toISOString(),
    source:"canonical createNationBuilding via building-showcase",count:icons.length,icons},null,2));
};

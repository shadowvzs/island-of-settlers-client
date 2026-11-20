import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial } from "three";

import { getAuthoredBuildingPlot } from "../../src/render-common/buildings/building-plot-profile";
import { CATAPULT_HATCH_WELL } from "../../src/render-common/buildings/catapult-hatch";
import { createCatapultTowerRecipe } from "../../src/render-common/buildings/catapult-tower-recipe";
import { prepareCatapultMesh, updateCatapultMesh } from "../../src/renderers/three/buildings/catapult-building-pose";
import type { CatapultSupply } from "../../src/shared/settlement/military-catapult-resupply";

const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const source = process.env.HATCH_LID_SOURCE ?? "civilian-huge-stone-runtime-16pass-2026-11-03/review.json";
const proof = JSON.parse(await readFile(`${folder}/${source}`, "utf8"));
const scale = getAuthoredBuildingPlot(16)!.structureScale, well = CATAPULT_HATCH_WELL;
const edge = well.center[0] - well.lower / 2, deckWorld = well.center[1] * scale;
const maximumPosedHeight = Math.max(...proof.diagonalBands.flatMap((entry: any) => entry.bands.map((band: any) => band.high)));
const reports = [];
for (const detailed of [true, false]) {
  const recipe = createCatapultTowerRecipe("roman", detailed);
  const parts = recipe.parts.filter(part => part.catapultPart === "hatch");
  let minimumSweepY = Infinity;
  const open = [];
  for (const part of parts) {
    assert.equal(part.shape, "box");
    const geometry = new BoxGeometry(...part.size!).translate(...part.position);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    prepareCatapultMesh(mesh, "hatch");
    for (let sample = 0; sample <= 90; sample++) {
      updateCatapultMesh(mesh, undefined, 0, 1,
        { porter: { phase: "stairs-up", elapsed: sample / 90 * .35 } } as unknown as CatapultSupply);
      mesh.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(mesh);
      minimumSweepY = Math.min(minimumSweepY, bounds.min.y);
      if (sample === 90) {
        const gap = (edge - bounds.max.x) * scale;
        assert(gap >= .01 - 1e-6, `Open lid enters clear well: ${gap}`);
        open.push({ bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, wellGapWorld: gap });
      }
    }
    geometry.dispose(); mesh.material.dispose();
  }
  const movingActorTop = .4 * .35 + maximumPosedHeight;
  const movingLidBottom = minimumSweepY * scale;
  assert(movingLidBottom > movingActorTop + .01);
  reports.push({ detail: detailed ? "high" : "minimal", open,
    openingBeforeActorMarginWorld: movingLidBottom - movingActorTop,
    maximumPosedHeightWorld: maximumPosedHeight, deckWorld,
    note: "Lid moves during first/last0.35s of stairs; porter moves0.4m/s. Full-open actual recipe meshes stay outside the entire lower-well prism." });
}
await writeFile(`${folder}/civilian-lid-clearance.json`, JSON.stringify({ source, reports }, null, 2));
console.log(JSON.stringify({ reports }));

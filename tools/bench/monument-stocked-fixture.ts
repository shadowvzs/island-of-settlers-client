import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getConstructionCost } from "../../src/shared/settlement/construction-costs";
import { createNaturalProgressionSession } from "./natural-progression-session";

const output = resolve(process.env.OUT ?? "../resources/project-reviews/acceptance-2026-10-28/monument-construction");
const source = JSON.parse(await readFile(resolve(output, "initial.json"), "utf8"));
const session = await createNaturalProgressionSession(source), { sim } = session;
const site = sim.buildings().find(building => building.typeId === 7)!;
// Authored prepared flat foundation: withholding the sole hammer must not also block deliveries.
site.foundationProgress = 1;
assert.equal(sim.takeStoredGoods({ hammer: 1 }).hammer, 1);
const cost = getConstructionCost(7);
let ticks = 0;
for (; ticks < 100000; ticks++) {
  sim.update(.05);
  if (Object.entries(cost).every(([ware, count]) => site.input[ware] === count)) break;
}
assert(ticks < 100000, "Actual carriers deliver every material to the prepared site");
assert.equal(site.construction, 0); assert.equal(site.worker, undefined);
assert(Object.values(site.constructionConsumed ?? {}).every(count => count === 0));
assert.equal(sim.frames().some(actor => actor.job === "Builder"), false);
assert.equal(sim.headquarters.inventory.hammer, 0);
await writeFile(resolve(output, "stocked-authored-foundation.json"), JSON.stringify(await session.save()));
const report = { provenance: "Derived finite visualfixture only: flatfoundation explicitlyauthored prepared, originalonehammer withdrawn through actualstoragecommand andheldoutsidegame; no seededpileinput. All200wares physicallydelivered by actualcarriers. Doesnotprove earnedgroundprep/constructioncompletion.",
  heldOutsideGame: { hammer: 1 }, input: site.input, construction: site.construction, ticks };
await writeFile(resolve(output, "stocked-authored-foundation-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

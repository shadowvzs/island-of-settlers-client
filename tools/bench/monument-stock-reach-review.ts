import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getRomanPartBounds } from "../../src/render-common/buildings/building-recipe-fit";
import { createWareRecipe } from "../../src/render-common/wares/ware-recipe";
import { WORKER_HEIGHT } from "../../src/render-common/workers/worker-dimensions";
import { getConstructionCost } from "../../src/shared/settlement/construction-costs";
import { constructionStockDisplayCapacity, constructionStockLayout } from "../../src/shared/settlement/construction-stock-layout";

const cost = getConstructionCost(7), reports = [];
for (const detailed of [true, false]) for (const ware of Object.keys(cost)) {
  const bounds = createWareRecipe(ware, detailed).parts.map(getRomanPartBounds);
  const minimum = Math.min(...bounds.map(bound => bound.min[1])), maximum = Math.max(...bounds.map(bound => bound.max[1]));
  const height = maximum - minimum, pitch = height + .018;
  const layout = constructionStockLayout(cost, ware, 19, 9, 9)!;
  const previousContactY = -minimum + .03 + 6 * pitch;
  const contactY = -minimum + .03 + layout.layer * pitch;
  const visibleTopY = contactY + maximum;
  const horizontalDistance = Math.hypot(layout.approach.x - layout.x, layout.approach.z - layout.z);
  assert(contactY <= WORKER_HEIGHT * .8, `${ware} contact target remains below upper-body height`);
  assert(visibleTopY < WORKER_HEIGHT, `${ware} pile remains below worker head`);
  assert(horizontalDistance <= .600001);
  reports.push({ ware, detailed, ownedUnits: cost[ware], visibleProps: constructionStockDisplayCapacity(cost, ware),
    previousContactY, contactY, visibleTopY, horizontalDistance });
}
const report = { workerHeight: WORKER_HEIGHT,
  scope: "Canonical recipe bounds and shared physical/native layout. Representative six-prop stock per ware; twenty actual paid units remain in input. Below-head stock and below-upper-body contact targets; this geometry bound alone does not claim exact animated palm fit.", reports };
const output = resolve(process.env.OUT ?? "../resources/project-reviews/acceptance-2026-10-28/monument-construction");
await writeFile(resolve(output, "stock-reach-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ workerHeight: WORKER_HEIGHT, previousMaximumContactY: Math.max(...reports.map(row => row.previousContactY)),
  maximumContactY: Math.max(...reports.map(row => row.contactY)), maximumVisibleTopY: Math.max(...reports.map(row => row.visibleTopY)) }));

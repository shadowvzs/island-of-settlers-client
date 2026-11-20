import { expect, it } from "vitest";

import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import baseline from "./fixtures/catapult-before-masonry-optimization.json";

// Captured before the budget optimization, rather than comparing two newly changed recipes.
// Owner national-shell revision replaces shaft walls; moving parts, stock and anchors stay canonical.
// Owner 2026-11-04: the functional side bearing carrier and deck-flush stem extension close
// Catapult16's floating axle/stem gaps (continuation-building-gallery-2026-11-04.md); the fixture
// includes both as canonical mechanics.
// Actual old stair/hatch voids are checked by catapult-national-shell-profile/geometry tests.
it.each(baseline)("preserves pre-optimization mechanics and stock beneath the authorized national shell ($detailed)", before => {
  const { parts, ...anchors } = createCatapultTowerRecipe("roman", before.detailed);
  const structural = parts.filter(part => part.catapultPart || part.stock);
  // JSON normalizes optional undefined properties in the source-authored recipe.
  expect(JSON.parse(JSON.stringify(anchors))).toEqual(before.anchors);
  // Owner 2026-11-03: only two stones upstairs; the old extra four slots are intentionally retired.
  const retained = before.parts.filter(part => (part.catapultPart || part.stock) && (!part.stock || part.stock.slot < 2));
  // Facet counts on tiny pins/bearing discs may change for LOD budget; physical dimensions do not.
  const physical=(items:unknown[])=>items.map(item=>{
    const {radialSegments:_facets,...part}=item as Record<string,unknown>;return part;
  });
  expect(physical(JSON.parse(JSON.stringify(structural)))).toEqual(physical(retained));
});

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../island-of-settlers-shared/src/road-decoration-items";

it("unapplied custody migration registers the exact same known SKU set for wallet stacks and placed custody", () => {
  // The latest custody migration (0037) replaces the checksum-stable, already-applied 0031/0032
  // constraints with the full current set, including the released bamboo grove SKUs.
  const sql = readFileSync(new URL("../../island-of-settlers-db/migrations/0037_road_bamboo_custody.sql", import.meta.url), "utf8");
  const lists = [...sql.matchAll(/item_id IN \(\n((?:    '[^']+'(?:,)?\n)+)(?:  \)|\)\))/g)];
  expect(lists).toHaveLength(2);
  const expected = Object.keys(ROAD_DECORATION_ITEM_DEFINITIONS).sort();
  for (const list of lists) expect([...list[1]!.matchAll(/'([^']+)'/g)].map(row => row[1]).sort()).toEqual(expected);
});

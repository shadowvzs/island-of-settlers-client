import { expect, it } from "vitest";

import { markLoadedRevisions, saveNavigationRevisions } from "../src/shared/settlement/settlement-load-revisions";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";

const fixture = (build: number, roads: number) => ({ options: { world: { buildRevision: build }, roads: { revision: roads } } }) as unknown as SettlementContext;
it("keeps one logical navigation epoch across different raw fresh and live revision counters", () => {
  const live = fixture(2000, 31), fresh = fixture(42, 1), epoch = { build: 1596, roads: 20 };
  markLoadedRevisions(live, epoch); markLoadedRevisions(fresh, epoch);
  expect(saveNavigationRevisions(live)).toEqual(epoch);
  expect(saveNavigationRevisions(fresh)).toEqual(epoch);
  live.options.world.buildRevision!++; fresh.options.world.buildRevision!++;
  Object.assign(live.options.roads, { revision: 32 }); Object.assign(fresh.options.roads, { revision: 2 });
  expect(saveNavigationRevisions(live)).toEqual({ build: 1597, roads: 21 });
  expect(saveNavigationRevisions(fresh)).toEqual(saveNavigationRevisions(live));
});
it("keeps historical absent metadata on its existing since-load initialization", () => {
  const context = fixture(2000, 31); markLoadedRevisions(context);
  expect(saveNavigationRevisions(context)).toEqual({ build: 0, roads: 0 });
});

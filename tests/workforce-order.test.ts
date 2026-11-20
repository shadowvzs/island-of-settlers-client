import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { getWorkforceInventoryEntries } from "../src/app/settlement-ui/building-details/workforce-helpers";
import { WorkforceSection } from "../src/app/settlement-ui/building-details/workforce-section";
import { compareWorkerJobs } from "../src/app/settlement-ui/worker-order";
import { ALL_PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import { renderWithI18n } from "./helpers/render-with-i18n";

const workforce = { Scout: 2, Miner: 1, Winegrower: 3, Builder: 4, Woodcutter: 2, Carrier: 5, Archer: 1 };

describe("storage workforce ordering", () => {
  it("puts real idle settlers first, then logical professions independent of recruitment insertion order", () => {
    const entries = getWorkforceInventoryEntries(workforce, 7);
    expect(entries.map(entry => entry.job)).toEqual([
      "available", "Carrier", "Builder", "Woodcutter", "Winegrower", "Miner", "Scout", "Archer"
    ]);
    expect(entries[0]).toEqual({ count: 7, job: "available", label: "Idle settlers stored here" });
    expect(entries).toEqual(getWorkforceInventoryEntries(Object.fromEntries(Object.entries(workforce).reverse()), 7));
    expect(Object.fromEntries(entries.slice(1).map(entry => [entry.job, entry.count]))).toEqual(workforce);
  });

  it("keeps an honest empty idle count and preserves unknown future professions", () => {
    expect(getWorkforceInventoryEntries({ Zebra: 2, Builder: 1, Alpha: 3, Hunter: 0 })).toEqual([
      { count: 0, job: "available", label: "Idle settlers stored here" },
      { count: 0, job: "Carrier", label: "Carriers" },
      { count: 1, job: "Builder", label: "Builder" },
      { count: 3, job: "Alpha", label: "Alpha" },
      { count: 2, job: "Zebra", label: "Zebra" }
    ]);
  });

  it("orders current civilian professions before unknown roles and military last", () => {
    for (const { job } of ALL_PRODUCTION_RULES) {
      if (job !== "Soldier") expect(compareWorkerJobs(job, "A future profession")).toBeLessThan(0);
    }
    expect(["Archer", "Zebra", "Scout", "Soldier"].sort(compareWorkerJobs))
      .toEqual(["Scout", "Zebra", "Soldier", "Archer"]);
  });

  it("renders the shared headquarters/storehouse/harbour list in the same accessible order", () => {
    const markup = renderWithI18n(createElement(WorkforceSection, { availableSettlers: 7, workforce }));
    expect([...markup.matchAll(/data-job="([^"]+)"/g)].map(match => match[1])).toEqual([
      "available", "Carrier", "Builder", "Woodcutter", "Winegrower", "Miner", "Scout", "Archer"
    ]);
    expect(markup).toContain('aria-label="Idle settlers stored here: 7" data-count="7" data-job="available"');
  });
});

import { describe, expect, it } from "vitest";

import { inspectScenarioEconomy } from "../src/shared/settlement/scenario-economy-inspection";
import type { ScenarioSpaceReport } from "../src/shared/settlement/settlement-scenario-space";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { WorldData } from "../src/shared/world/world-data";

const fixture = (required: number[]) => {
  const scenario = { ...createMapScenario(), headquarters: { x: 10, z: 10, rotation: 0 },
    stock: { hammer: 1 } as Record<string, number> };
  const world = { scenario } as WorldData;
  const space: ScenarioSpaceReport = {
    expansion: [], harbours: [], expansionChecks: 0, harbourChecks: 0, messages: [],
    roads: [], spatialPlanProved: false, startupSpatialProved: false, authoredErrors: [],
    workspaces: [], candidateCount: 0, budgetExhausted: false, durationMs: 0,
    stages: [{ name: "Startup", mandatory: true, required, found: [...required], unknown: [] }]
  };
  const inspect = () => inspectScenarioEconomy(world, space);
  return { scenario, world, space, inspect };
};

describe("authored initial economy diagnostics", () => {
  it("does not claim economy readiness for an invalid or missing authored start", () => {
    const f = fixture([35]); f.space.authoredErrors.push("Invalid HQ");
    expect(f.inspect()).toEqual([expect.objectContaining({ name: "Starting economy", outcome: "unknown" })]);
  });

  it("reports scarce worker tools and simultaneous staffing independently of clear plots", () => {
    const f = fixture([17, 20]); f.scenario.settlers = 1;
    const findings = f.inspect();
    expect(findings.find(row => row.name === "Starting worker tools")).toMatchObject({ outcome: "unknown" });
    expect(findings.find(row => row.name === "Starting workforce")).toMatchObject({ outcome: "unknown" });
    expect(findings.find(row => row.name === "Starting workforce")!.detail).toContain("1/4");
  });

  it("distinguishes an upfront construction shortage from a proven impossible map", () => {
    const f = fixture([35]);
    const result = f.inspect().find(row => row.name === "Startup construction materials")!;
    expect(result.outcome).toBe("unknown");
    expect(result.detail).toContain("not an impossibility result");
  });

  it("never credits an unplaced indoor producer as an available dependency", () => {
    const f = fixture([35]); f.space.stages[0]!.found = [];
    expect(f.inspect().find(row => row.name === "Startup production dependencies")!.outcome).toBe("unknown");
  });

  it("requires native work access before claiming logs can supply a sawmill", () => {
    const f = fixture([17, 33]); f.scenario.stock.axe = 1; f.scenario.stock.saw = 1;
    expect(f.inspect().find(row => row.name === "Startup production dependencies")!.outcome).toBe("unknown");
    f.space.workspaces = [{ typeId: 17, kind: "tree", outcome: "witness", points: [], searches: 1, detail: "Native target" }];
    expect(f.inspect().find(row => row.name === "Startup production dependencies")!.outcome).toBe("witness");
  });

  it("does not substitute advanced colony logs for base sawmill inputs", () => {
    const f = fixture([42, 33]); f.scenario.stock.axe = 1; f.scenario.stock.saw = 1;
    f.space.workspaces = [{ typeId: 42, kind: "tree", outcome: "witness", points: [], searches: 1, detail: "Hardwood" }];
    const result = f.inspect().find(row => row.name === "Startup production dependencies")!;
    expect(result.outcome).toBe("unknown"); expect(result.detail).toContain("33 needs logs");
    const before = structuredClone(f.world);
    f.scenario.stock.logs = 2;
    expect(f.inspect().find(row => row.name === "Startup production dependencies")!.outcome).toBe("witness");
    expect(f.scenario.stock.logs).toBe(2);
    expect(before.scenario!.stock.logs).toBeUndefined();
  });
});

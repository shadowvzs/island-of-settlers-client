import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createScenarioWorkspaceInspector } from "../src/shared/settlement/scenario-workspace-inspection";
import { createScenarioInspectionContext } from "../src/shared/settlement/settlement-map-scenario";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { BUILD, PROP } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const inspectScenarioWorkspaces = (context: SettlementContext, buildings: readonly SettlementBuilding[]) =>
  buildings.flatMap(createScenarioWorkspaceInspector(context, Infinity).inspect);

const fixture = (nation: WorkerNation = "roman") => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, forest: 0,
    mountains: 0, rivers: 0, erosionDroplets: 0 });
  world.heights.fill(2); world.waterSurface.fill(0); world.waterDepth.fill(0);
  world.props = { count: 0, form: new Uint8Array(1), phase: new Float32Array(1), rotation: new Float32Array(1),
    scale: new Float32Array([1]), types: new Uint8Array(1), x: new Float32Array([32]),
    y: new Float32Array([2]), z: new Float32Array([30]) };
  world.blocking.fill(0); world.walkCost.fill(10); world.buildClass.fill(BUILD.large);
  world.buildCap.fill(BUILD.large); world.slopeClass.fill(0);
  world.scenario = { ...createMapScenario(), nation };
  const context = createScenarioInspectionContext(world);
  const building = (type: number, x = 24, z = 24) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const result = makeBuilding(context, type, x + width % 2 / 2, z + depth % 2 / 2);
    result.construction = 1; context.buildings.push(result);
    return result;
  };
  return { world, context, building };
};

describe("native editor workspaces and contention", () => {
  it.each([["roman", "vine"], ["japanese", "rice"], ["viking", "hive"], ["nubian", "palm"]] as const)(
    "uses the authored %s provider for %s, without changing world or reservations", (nation, crop) => {
      const f = fixture(nation), building = f.building(5);
      const before = structuredClone(f.world);
      const result = inspectScenarioWorkspaces(f.context, [building]);
      expect(f.context.playerNation).toBe(nation);
      expect(result[0]).toMatchObject({ outcome: "witness", kind: "field", buildingUid: building.uid });
      expect(result[0]!.detail).toContain(`Native ${crop}`);
      expect(f.world).toEqual(before);
      expect(f.context.reservations.size).toBe(0);
      expect(f.context.fieldCycles).toBeUndefined();
    });
  it("does not invent charcoal input stock to turn empty land into a production witness", () => {
    const f = fixture(), building = f.building(27);
    expect(inspectScenarioWorkspaces(f.context, [building])[0]!.outcome).toBe("unknown");
    f.world.scenario!.stock.logs = 1;
    expect(inspectScenarioWorkspaces(f.context, [building])[0]!.outcome).toBe("witness");
    expect(f.world.scenario!.stock.logs).toBe(1);
    expect(building.input).toEqual({});
  });
  it("does not promise two simultaneous charcoal starts from one authored log", () => {
    const f = fixture(), first = f.building(27), second = f.building(27, 42, 24);
    f.world.scenario!.stock.logs = 1;
    const inspector = createScenarioWorkspaceInspector(f.context);
    expect(inspector.inspect(first)[0]!.outcome).toBe("witness");
    expect(inspector.inspect(second)[0]!.outcome).toBe("unknown");
    expect(f.world.scenario!.stock.logs).toBe(1);
  });
  it("uses authored native growth age instead of crediting a seedling as immediate logs", () => {
    const f = fixture(); f.world.props.count = 1; f.world.props.types[0] = PROP.coniferTree;
    f.world.authoredTreeAges = { 0: 0 };
    const cutter = f.building(17, 24, 26);
    expect(inspectScenarioWorkspaces(f.context, [cutter])[0]!.outcome).toBe("unknown");
    f.world.authoredTreeAges[0] = 120;
    expect(inspectScenarioWorkspaces(f.context, [cutter])[0]!.outcome).toBe("witness");
  });
  it("never lets two quarry jobs claim the same finite initial boulder", () => {
    const f = fixture(); f.world.props.count = 1; f.world.props.types[0] = PROP.largeRock;
    const first = f.building(19, 24, 26), second = f.building(19, 36, 26);
    const inspector = createScenarioWorkspaceInspector(f.context);
    expect(inspector.inspect(first)[0]!.outcome).toBe("witness");
    expect(inspector.inspect(second)[0]!.outcome).toBe("unknown");
    expect(f.context.reservations.size).toBe(0);
    expect(f.world.props.types[0]).toBe(PROP.largeRock);
  });
  it("reserves native crop cells across separately yielded inspector calls", () => {
    const f = fixture(), first = f.building(5), second = { ...first, uid: first.uid + 100 };
    const inspector = createScenarioWorkspaceInspector(f.context);
    const a = inspector.inspect(first)[0]!, b = inspector.inspect(second)[0]!;
    expect(a.outcome).toBe("witness"); expect(b.outcome).toBe("witness");
    expect(a.points[0]).not.toEqual(b.points[0]);
  });
});

describe("static native hunting evidence", () => {
  it("uses real prey coordinates and reserves one animal for only one simultaneous hunter", () => {
    const f = fixture(), first = f.building(22), second = f.building(22, 38, 24);
    const wildlife = { source: "native-current-pool" as const, overflow: false,
      targets: [{ id: 7, kind: "wildlife" as const, x: 32, z: 30 }] };
    const before = structuredClone(wildlife);
    const inspector = createScenarioWorkspaceInspector(f.context, Infinity, wildlife);
    const witness = inspector.inspect(first)[0]!;
    expect(witness.outcome).toBe("witness");
    expect(witness.points).toEqual([{ x: 32, z: 30 }]);
    expect(witness.detail).toContain("static current-population witness");
    expect(inspector.inspect(second)[0]!.outcome).toBe("unknown");
    expect(wildlife).toEqual(before);
    expect(f.context.reservations.size).toBe(0);
  });
  it("does not infer hunting access across an actual impassable water strip", () => {
    const f = fixture(), hunter = f.building(22);
    for (let z = 0; z < f.world.cellsZ; z++) for (let x = 29; x <= 36; x++)
      f.world.walkCost[z * f.world.cellsX + x] = 0;
    const wildlife = { source: "native-current-pool" as const, overflow: false,
      targets: [{ id: 1, kind: "wildlife" as const, x: 42, z: 30 }] };
    expect(createScenarioWorkspaceInspector(f.context, Infinity, wildlife).inspect(hunter)[0]!.outcome).toBe("unknown");
  });
  it("keeps unavailable, overflowing and invalid population snapshots UNKNOWN", () => {
    const f = fixture(), hunter = f.building(22);
    for (const wildlife of [undefined, { source: "native-current-pool" as const, targets: [], overflow: true },
      { source: "native-current-pool" as const, targets: [{ id: 1, kind: "wildlife" as const, x: NaN, z: 3 }], overflow: false }])
      expect(createScenarioWorkspaceInspector(f.context, Infinity, wildlife).inspect(hunter)[0]!.outcome).toBe("unknown");
  });
});

import { beforeAll, describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { FARM_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { BLOCKING, PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { steadyIslandSave } from "./helpers/offline-steady-island";

const SECONDS = 3600;
const FARM_WARM_SECONDS = 300;
const RESUME_SECONDS = 60;
const TIMEOUT = 300_000;

interface Fingerprint { e1: string; e2: string }

const fingerprint = async (save: GameSaveV1): Promise<Fingerprint> => {
  const loaded = await stageGameSession(save);
  return {
    e1: valueStateKey({ player: save.player, runtime: loaded.runtime, settlement: loaded.settlement }),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world })
  };
};

describe("event-core real-save comparator", () => {
  let source: GameSaveV1;
  beforeAll(async () => {
    const island = await createHeadlessIsland(await steadyIslandSave(), true);
    const [width, depth] = getBuildingDefinition(FARM_TYPE_ID).gridFootprint;
    let placed: ReturnType<typeof island.simulation.placeBuilding> | undefined;
    for (const [x, z] of [[24, 38], [32, 42], [28, 46], [42, 38], [16, 22], [34, 14], [14, 30]] as const) {
      const result = island.simulation.placeBuilding(FARM_TYPE_ID, x + width / 2, z + depth / 2);
      if (result.ok) { placed = result; break; }
    }
    if (!placed?.ok) throw new Error(placed?.reason ?? "no free farm plot");
    Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
    if (!island.simulation.connectRoads(island.simulation.headquarters.access, placed.building!.access))
      throw new Error("the farm road did not connect");
    island.simulation.headquarters.inventory.scythe = (island.simulation.headquarters.inventory.scythe ?? 0) + 2;
    for (let tick = 0; tick < FARM_WARM_SECONDS / .05; tick++) island.simulation.update(.05);
    const boulder = island.world.props.types.subarray(0, island.world.props.count).indexOf(PROP.largeRock);
    if (boulder < 0) throw new Error("the fixture has no boulder for the stone timer");
    island.world.props.types[boulder] = PROP_REMOVED;
    island.world.blocking[Math.floor(island.world.props.z[boulder]!) * island.world.cellsX +
      Math.floor(island.world.props.x[boulder]!)] = BLOCKING.free;
    source = await island.save();
    source.settlement.stoneRespawns = [{ id: boulder, kind: "prop", restSeconds: 299 }];
    if (!source.settlement.fields.length) throw new Error("the farm did not plant fields");
  }, TIMEOUT);

  it("matches the exact fixed tick and survives the E3 resume window", async () => {
    const base = structuredClone(source);
    const at = base.savedAt + SECONDS * 1000;
    const exact = await advanceOfflineGame(structuredClone(base), at, () => {}, { exact: true, eventCore: false });
    const eventMetrics: import("../src/app/settlement/offline-island-replay").OfflineIslandMetrics[] = [];
    const event = await advanceOfflineGame(structuredClone(base), at, () => {},
      { eventCore: true, onIslandMetrics: value => eventMetrics.push(value) });
    expect(eventMetrics[0]?.eventCore, "the event core is active").toBeDefined();
    expect(eventMetrics[0]?.eventCoreCoverage?.reasons).toEqual([]);
    expect(JSON.stringify(exact.settlement.fields), "the fixture changes a field")
      .not.toBe(JSON.stringify(base.settlement.fields));
    expect(base.settlement.stoneRespawns, "the fixture has a resting boulder").toHaveLength(1);
    expect(JSON.stringify(exact.settlement.stoneRespawns), "the stone timer advances")
      .not.toBe(JSON.stringify(base.settlement.stoneRespawns));
    expect({ births: exact.settlement.settlerBirths, growth: exact.settlement.settlerGrowthTime },
      "the fixture changes the population timer").not.toEqual({ births: base.settlement.settlerBirths,
      growth: base.settlement.settlerGrowthTime });
    expect(JSON.stringify(exact.runtime && (exact.runtime as { growth?: unknown }).growth), "the fixture grows trees")
      .not.toBe(JSON.stringify(base.runtime && (base.runtime as { growth?: unknown }).growth));
    const [exactPrint, eventPrint] = await Promise.all([fingerprint(exact), fingerprint(event)]);
    expect(eventPrint, "E1/E2 value state").toEqual(exactPrint);

    const exactResumed = await advanceOfflineGame(structuredClone(exact), at + RESUME_SECONDS * 1000,
      () => {}, { exact: true, eventCore: false });
    const eventResumed = await advanceOfflineGame(structuredClone(event), at + RESUME_SECONDS * 1000,
      () => {}, { exact: true, eventCore: false });
    const [exactResumePrint, eventResumePrint] = await Promise.all([
      fingerprint(exactResumed), fingerprint(eventResumed)
    ]);
    expect(eventResumePrint, "E3 resume value state").toEqual(exactResumePrint);
  }, TIMEOUT);
});

import { beforeAll, describe, expect, it } from "vitest";

import type { SaveSnapshot } from "../src/app/save-store/save-api-client";
import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { FORESTER_TYPE_ID, WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { type CommandLogInterval, createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { determinismIslandSave } from "./helpers/determinism-island";

const SLOW_TIMEOUT = 300_000;

interface PlayedChain { base: SaveSnapshot; end: SaveSnapshot; intervals: CommandLogInterval[] }

/**
 * A client session: two upload intervals of play with the in-place snapshot reload between them (D3), recorded
 * by the command log recorder, ending with the uploaded snapshot.
 */
const playChain = async (): Promise<PlayedChain> => {
  const save = await determinismIslandSave();
  const client = await createHeadlessIsland(save), { simulation } = client;
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
  const play = (ticks: number) => { for (let index = 0; index < ticks; index++) simulation.update(.05); };
  const build = (type: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width / 2, z + depth / 2);
    expect(placed.ok, placed.reason).toBe(true);
    expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  };
  recorder.open();
  play(10);
  build(WOODCUTTER_TYPE_ID, 34, 30);
  play(400);
  const first = recorder.close("home")!;
  expect(simulation.reloadSnapshot(simulation.saveState()).ok).toBe(true);
  recorder.open();
  build(FORESTER_TYPE_ID, 34, 40);
  play(300);
  simulation.setProductionPaused(simulation.buildings()[1]!.uid, true);
  play(100);
  const second = recorder.close("home")!;
  return { base: toSaveSnapshot(save), end: toSaveSnapshot(await client.save!()),
    intervals: [{ ...first, baseRevision: 1 }, second] };
};

describe("server verification of command logs (D4.3)", () => {
  let chain: PlayedChain;
  beforeAll(async () => { chain = await playChain(); }, SLOW_TIMEOUT);

  it("verifies an honest chain of intervals", async () => {
    expect(chain.intervals[1]!.entries.map(entry => entry.command.name))
      .toEqual(["placeBuilding", "connectRoads", "setProductionPaused"]);
    expect(await verifyCommandLogs(chain)).toEqual({ status: "verified", ticks: 810 });
  }, SLOW_TIMEOUT);

  it("catches a forged command and reports the server's draw trail of that interval", async () => {
    const forged = structuredClone(chain.intervals);
    // The log claims the forester stands two cells further east than the client really placed it.
    const place = forged[1]!.entries[0]!.command;
    place.args = [place.args[0], (place.args[1] as number) + 2, ...place.args.slice(2)];
    const result = await verifyCommandLogs({ ...chain, intervals: forged });
    expect(result).toMatchObject({ interval: 1, island: "home", status: "mismatch", trailTick: 810 });
    expect(result.trail!.length).toBeGreaterThan(0);
  }, SLOW_TIMEOUT);

  it("catches stock edited into the uploaded snapshot", async () => {
    const end = structuredClone(chain.end);
    const settlement = (end.islands[0]!.save.data as {
      settlement: { storagePools: { pools: { available: Record<string, number> }[] } };
    }).settlement;
    const pool = settlement.storagePools.pools[0]!;
    pool.available.planks = (pool.available.planks ?? 0) + 500;
    expect(await verifyCommandLogs({ ...chain, end })).toMatchObject({ status: "mismatch",
      mismatch: { kind: "snapshot" } });
  }, SLOW_TIMEOUT);

  it("skips a chain without a verified base", async () => {
    const intervals = chain.intervals.map(interval => ({ ...interval, baseRevision: null }));
    expect(await verifyCommandLogs({ ...chain, intervals })).toMatchObject({ status: "skipped" });
  }, SLOW_TIMEOUT);
});


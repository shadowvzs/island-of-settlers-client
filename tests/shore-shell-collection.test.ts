import { describe, expect, it } from "vitest";

import { listShoreShellSpots } from "../src/render-common/props/shore-shell-spots";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  collectShoreShell, createShoreShellLedger, getShoreShellPositions, restoreShoreShellLedger,
  SHORE_RESPAWN_MIN_SHARE
} from "../src/shared/settlement/shore-shell-collection";
import { cachedWorld } from "./helpers/cached-worlds";

const createWorld = () => structuredClone(
  cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 4000 }));

describe("shore shell collecting", () => {
  it("respawns the same shell far away, deterministically, and restores from the saved ledger", () => {
    const world = createWorld();
    const spots = listShoreShellSpots(world);
    expect(spots.length).toBeGreaterThan(3);
    const ledger = createShoreShellLedger();
    const result = collectShoreShell(world, ledger, 2);
    expect(result).not.toBeNull();
    const { event, from, to } = result!;
    expect(event.type).toBe("shoreShellCollected");
    expect(event.index).toBe(2);
    expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThanOrEqual(SHORE_RESPAWN_MIN_SHARE * 96);
    expect(getShoreShellPositions(world, ledger)[2]).toEqual(to);
    expect(world.shoreShellMoves).toEqual([2, to.x, to.z]);

    const replay = createWorld();
    expect(collectShoreShell(replay, createShoreShellLedger(), 2)?.to).toEqual(to);

    const restoredWorld = createWorld();
    const restored = restoreShoreShellLedger(restoredWorld, structuredClone(ledger));
    expect(restored).toEqual(ledger);
    expect(restoredWorld.shoreShellMoves).toEqual([2, to.x, to.z]);
  });

  it("moves a shell again when collected again and rejects unknown shells or bad saves", () => {
    const world = createWorld();
    const ledger = createShoreShellLedger();
    const first = collectShoreShell(world, ledger, 0)!;
    const second = collectShoreShell(world, ledger, 0)!;
    expect(ledger.collected).toBe(2);
    expect(ledger.moves).toEqual([0, second.to.x, second.to.z]);
    expect(Math.hypot(second.to.x - first.to.x, second.to.z - first.to.z))
      .toBeGreaterThanOrEqual(SHORE_RESPAWN_MIN_SHARE * 96);
    expect(collectShoreShell(world, ledger, -1)).toBeNull();
    expect(collectShoreShell(world, ledger, 1e6)).toBeNull();
    expect(restoreShoreShellLedger(createWorld(), { collected: 1, moves: [1e6, 1, 1] }))
      .toEqual(createShoreShellLedger());
  });

  it("collects through the home-island simulation command and keeps the move across save and load", () => {
    const world = createWorld();
    const simulation = createSettlementSimulation({ initialSettlers: 0, roads: createRoadNetwork(world), world });
    const events: unknown[] = [];
    simulation.onShoreShellCollected((event) => events.push(event));
    const result = simulation.collectShoreShell(1);
    expect(result?.event).toMatchObject({ index: 1, type: "shoreShellCollected" });
    expect(events).toHaveLength(1);
    expect(simulation.shoreShellsCollected()).toBe(1);
    const saved = structuredClone(simulation.saveState());
    const reloadedWorld = createWorld();
    const reloaded = createSettlementSimulation({ initialSettlers: 0, roads: createRoadNetwork(reloadedWorld),
      world: reloadedWorld });
    expect(reloaded.loadState(saved).ok).toBe(true);
    expect(reloaded.shoreShellsCollected()).toBe(1);
    expect(reloadedWorld.shoreShellMoves).toEqual([1, result!.to.x, result!.to.z]);
  });
});

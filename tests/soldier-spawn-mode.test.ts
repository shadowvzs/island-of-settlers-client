import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebugClickModes } from "../src/app/settlement/debug-click-modes";
import { createSoldierSpawnMode } from "../src/app/settlement/soldier-spawn-mode";
import type { DebugSoldierSpawn } from "../src/shared/settlement/settlement-debug-troop";

const createMode = (spawn: DebugSoldierSpawn | null, ground: { x: number; z: number } | null = { x: 20, z: 21 }) => {
  const messages: Array<[string, boolean | undefined]> = [];
  const spawnDebugSoldier = vi.fn(() => spawn);
  const mode = createSoldierSpawnMode({ cancelPlacement: vi.fn(),
    message: (text, warning) => messages.push([text, warning]), pickGround: () => ground,
    simulation: { playerNation: () => "roman", spawnDebugSoldier } });
  return { messages, mode, spawnDebugSoldier };
};

describe("spawn soldier click mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("spawns at the clicked ground and turns off with Escape", () => {
    const keys = new EventTarget();
    vi.stubGlobal("window", keys);
    const { messages, mode, spawnDebugSoldier } = createMode({ id: 9, rank: 2, type: "archer" });
    const watcher = vi.fn();
    mode.watch(watcher);
    mode.set(true);
    mode.click(10, 20);
    expect(spawnDebugSoldier).toHaveBeenCalledWith({ x: 20, z: 21 });
    expect(messages.at(-1)).toEqual(["Archer (rank 3) spawned at the clicked ground.", false]);
    const escape = Object.assign(new Event("keydown"), { key: "Escape" });
    keys.dispatchEvent(escape);
    expect(mode.active()).toBe(false);
    expect(watcher.mock.calls).toEqual([[true], [false]]);
    mode.dispose();
  });

  it("warns when there is no walkable ground or the spawn is refused", () => {
    vi.stubGlobal("window", new EventTarget());
    const noGround = createMode(null, null), refused = createMode(null);
    noGround.mode.click(0, 0);
    refused.mode.click(0, 0);
    expect(noGround.spawnDebugSoldier).not.toHaveBeenCalled();
    expect(noGround.messages).toEqual([["No walkable ground under the cursor.", true]]);
    expect(refused.messages).toEqual([["No soldier spawned: choose clear, walkable ground.", true]]);
  });

  it("shares the exclusive map-click mode with the enemy and building tools", () => {
    vi.stubGlobal("window", new EventTarget());
    const spawnDebugSoldier = vi.fn(() => ({ id: 3, rank: 1, type: "heavy" as const }));
    const modes = createDebugClickModes({ allowed: true, buildingName: () => "Workshop",
      cancelPlacement: vi.fn(), enemyNation: () => "roman", message: vi.fn(),
      onRaised: vi.fn(), pickBuilding: () => undefined, pickGround: () => ({ x: 12, z: 13 }),
      simulation: { debugRaiseBuildingLevel: vi.fn(), playerNation: () => "roman",
        spawnDebugEnemy: vi.fn(() => null), spawnDebugShip: vi.fn(() => ({ ok: false as const, reason: "water" as const })),
        spawnDebugSoldier } });
    modes.controls.setEnemySpawnMode(true);
    expect(modes.controls.enemySpawnMode()).toBe(true);
    modes.controls.setSoldierSpawnMode(true);
    expect(modes.controls.enemySpawnMode()).toBe(false);
    expect(modes.controls.soldierSpawnMode()).toBe(true);
    modes.active()!.click(100, 200);
    expect(spawnDebugSoldier).toHaveBeenCalledWith({ x: 12, z: 13 });
    modes.controls.setBuildingLevelMode(true);
    expect(modes.controls.soldierSpawnMode()).toBe(false);
    modes.dispose();
  });
});

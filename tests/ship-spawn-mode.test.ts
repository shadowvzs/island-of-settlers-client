import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebugClickModes } from "../src/app/settlement/debug-click-modes";
import { createShipSpawnMode } from "../src/app/settlement/ship-spawn-mode";
import type { DebugShipSpawn } from "../src/shared/settlement/settlement-debug-ship";

const fixture = () => {
  const keys = new EventTarget();
  vi.stubGlobal("window", keys);
  const messages: Array<[string, boolean | undefined]> = [];
  const spawnDebugShip = vi.fn<() => DebugShipSpawn>(() => ({ ok: true, id: 1 }));
  const options = { cancelPlacement: vi.fn(), message: (text: string, warning?: boolean) => messages.push([text, warning]),
    pickGround: vi.fn(() => ({ x: 40.25, z: 32.5 })), simulation: { spawnDebugShip } };
  return { keys, messages, options, spawnDebugShip };
};

describe("create ship click mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays active for repeated clicks and refusals, reports the reason and Escape cancels", () => {
    const { keys, messages, options, spawnDebugShip } = fixture();
    const mode = createShipSpawnMode(options), watcher = vi.fn();
    mode.watch(watcher); mode.set(true); mode.click(10, 20);
    expect(spawnDebugShip).toHaveBeenCalledWith({ x: 40.25, z: 32.5 });
    expect(messages.at(-1)).toEqual(["Ship created in your fleet.", false]);
    spawnDebugShip.mockReturnValue({ ok: false, reason: "occupied" });
    mode.click(10, 20);
    expect(mode.active()).toBe(true);
    expect(messages.at(-1)).toEqual(["No ship created: another vessel or shipyard hull needs this space.", true]);
    keys.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(mode.active()).toBe(false);
    expect(watcher.mock.calls).toEqual([[true], [false]]);
    mode.dispose();
  });

  it("is exclusive with soldiers, enemies and building upgrades and unavailable without development access", () => {
    const { options } = fixture();
    const createModes = (allowed: boolean) => createDebugClickModes({ ...options, allowed,
      buildingName: () => "Workshop", enemyNation: () => "roman", onRaised: vi.fn(), pickBuilding: () => undefined,
      simulation: { ...options.simulation, debugRaiseBuildingLevel: vi.fn(), playerNation: () => "roman",
        spawnDebugEnemy: () => null, spawnDebugSoldier: () => null } });
    const modes = createModes(true);
    modes.controls.setSoldierSpawnMode(true); modes.controls.setShipSpawnMode(true);
    expect(modes.controls.soldierSpawnMode()).toBe(false);
    expect(modes.controls.shipSpawnMode()).toBe(true);
    modes.controls.setEnemySpawnMode(true);
    expect(modes.controls.shipSpawnMode()).toBe(false);
    modes.controls.setShipSpawnMode(true); modes.controls.setBuildingLevelMode(true);
    expect(modes.controls.shipSpawnMode()).toBe(false);
    const denied = createModes(false);
    denied.controls.setShipSpawnMode(true);
    expect(denied.active()).toBeUndefined();
    modes.dispose(); denied.dispose();
  });
});

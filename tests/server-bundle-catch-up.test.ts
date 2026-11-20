import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGACY_SIM_RULES, type SimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { fromSaveSnapshot, toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { pinSnapshotRules } from "../src/app/settlement/catch-up-rules";
import * as offlineProgress from "../src/app/settlement/offline-progress";
import { catchUpSnapshot } from "../src/app/settlement/server-bundle";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { completeGame } from "./save-fixtures";

// The unit project shares one module graph (isolate: false). A module-level `vi.mock` here would
// leak the fake catch-up/expiry implementation into other server-bundle tests that run later.
// Spy on the real binding and restore it instead.
const advanceOfflineGame = vi.spyOn(offlineProgress, "advanceOfflineGame");

afterAll(() => advanceOfflineGame.mockRestore());

const snapshot = () => toSaveSnapshot(completeGame());
const advanced = (source: GameSaveV1, now: number) => ({ ...source, savedAt: now });

describe("server game bundle: offline catch-up replay options", () => {
  beforeEach(() => {
    advanceOfflineGame.mockReset();
    advanceOfflineGame.mockImplementation(async (source: GameSaveV1, now: number) => advanced(source, now));
  });

  it("forwards the full serializable replay option set unchanged", async () => {
    const source = snapshot(), now = 1_000_000;
    const options = {
      chronological: true, chronologySliceSeconds: 30, corridorReservations: true, eventCore: true,
      eventMovement: true, exact: true, measured: true, movementSkip: true, quietSkip: true
    };
    const result = await catchUpSnapshot(source, now, options);
    expect(result).not.toBeNull();
    expect(advanceOfflineGame).toHaveBeenCalledWith(expect.anything(), now, undefined, options);
  });

  it("leaves shared duration selection enabled when the api sends no options", async () => {
    const now = 1_000_000;
    await catchUpSnapshot(snapshot(), now);
    expect(advanceOfflineGame).toHaveBeenCalledWith(expect.anything(), now, undefined, {});
  });

  it("advances under the lease-granted rules: every island is pinned to the server's copy (GS2, rev G4)", async () => {
    const granted: SimRules = { ...LEGACY_SIM_RULES, revision: "rev-granted", talents: false };
    const source = snapshot(), now = 1_000_000;
    await catchUpSnapshot(source, now, {}, { granted });
    const advancedGame = advanceOfflineGame.mock.calls[0]![0];
    expect(advancedGame.settlement.gameRules).toEqual(granted);
    const home = fromSaveSnapshot(source)!;
    // No time to advance, but a changed pin is still answered so the stored revision carries it.
    advanceOfflineGame.mockImplementation(async (game: GameSaveV1) => game);
    expect(await catchUpSnapshot(source, home.savedAt, {}, { granted })).not.toBeNull();
    expect(await catchUpSnapshot(source, home.savedAt, {}, { granted: LEGACY_SIM_RULES })).toBeNull();
  });
});

describe("catch-up rule pins", () => {
  const pinned: SimRules = { ...LEGACY_SIM_RULES, revision: "rev-1", trade: false };
  const pinnedSnapshot = () => pinSnapshotRules(snapshot(), { granted: pinned });

  it("keeps the same snapshot when the pins already match, and the legacy grant removes a pin", () => {
    const source = pinnedSnapshot();
    expect(pinSnapshotRules(source, { granted: pinned })).toBe(source);
    expect(pinSnapshotRules(source, undefined)).toBe(source);
    const legacy = pinSnapshotRules(source, { granted: LEGACY_SIM_RULES });
    expect(legacy.islands.every(row => !("gameRules" in (row.save.data.settlement as object)))).toBe(true);
  });

  it("background catch-up replaces each pin with the server's copy of its own revision", () => {
    const forged = pinSnapshotRules(snapshot(), { granted: { ...pinned, trade: true } });
    const resolved = pinSnapshotRules(forged, { byRevision: { [pinned.revision]: pinned } });
    expect(fromSaveSnapshot(resolved)!.settlement.gameRules).toEqual(pinned);
    expect(pinSnapshotRules(forged, { byRevision: {} })).toBe(forged);
  });
});

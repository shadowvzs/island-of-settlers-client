import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { readDevelopedFixture } from "./helpers/developed-fixture";

const SECONDS = 600;
const PARITY_TIMEOUT = 180_000;
const source = await readDevelopedFixture();
const at = source.savedAt + SECONDS * 1000;

const fingerprint = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  return {
    e1: valueStateKey({ player: save.player, runtime: loaded.runtime, settlement: loaded.settlement }),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world })
  };
};

describe("developed fixture parity", () => {
  it("keeps the event-core timer lane exact for 10 minutes", async () => {
    const exact = await advanceOfflineGame(structuredClone(source), at, () => {}, {
      exact: true, eventCore: false
    });
    const event = await advanceOfflineGame(structuredClone(source), at, () => {}, { eventCore: true });
    const autoMetrics: import("../src/app/settlement/offline-island-replay").OfflineIslandMetrics[] = [];
    const auto = await advanceOfflineGame(structuredClone(source), at, () => {}, {
      exact: true, onIslandMetrics: value => autoMetrics.push(value)
    });
    expect(autoMetrics[0]?.fallbackReason).toBeUndefined();
    expect(autoMetrics[0]?.eventCore).toBeDefined();
    expect(auto.settlement).toEqual(exact.settlement);
    const [exactPrint, eventPrint, autoPrint] = await Promise.all([
      fingerprint(exact), fingerprint(event), fingerprint(auto)
    ]);
    expect(eventPrint, "E1/E2 event-core value state").toEqual(exactPrint);
    expect(autoPrint, "E1/E2 auto value state").toEqual(exactPrint);
  }, PARITY_TIMEOUT);

  it("keeps the movement executor exact against the corridor-gated fixed tick", async () => {
    const fixed = await advanceOfflineGame(structuredClone(source), at, () => {}, {
      corridorReservations: true, exact: true
    });
    const executor = await advanceOfflineGame(structuredClone(source), at, () => {}, {
      corridorReservations: true, eventMovement: true, exact: true
    });
    expect(executor.settlement).toEqual(fixed.settlement);
    expect(executor.runtime).toEqual(fixed.runtime);
    expect(executor.player).toEqual(fixed.player);
  }, PARITY_TIMEOUT);
});

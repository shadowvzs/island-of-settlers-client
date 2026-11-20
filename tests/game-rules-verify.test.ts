import { describe, expect, it } from "vitest";

import { LEGACY_SIM_RULES, type SimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import { verifyCommandLogs } from "../src/app/settlement/command-log-verify";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { UNKNOWN_RULES_REVISION } from "../src/app/settlement/verifier-rules";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { determinismIslandSave } from "./helpers/determinism-island";

/** GS2: the server verifier replays the game rules it issued for a revision, never the client's copy. */

const ISSUED: SimRules = { ...LEGACY_SIM_RULES, level: { kind: "fixed", level: 1 }, revision: "rev-issued" };
const SIGHT_OFF: SimRules = { ...LEGACY_SIM_RULES, playerTroopsSightOnly: false, revision: "rev-sight-off" };
const SERVER_RULES = { [ISSUED.revision]: ISSUED, [SIGHT_OFF.revision]: SIGHT_OFF, legacy: LEGACY_SIM_RULES };

/** One upload interval of the home island from `base`, adopting `adopted` first when given. */
const play = async (base: GameSaveV1, adopted?: SimRules) => {
  const client = await createHeadlessIsland(base), { simulation } = client;
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
  recorder.open();
  if (adopted) expect(simulation.adoptGameRules(adopted)).toBe(true);
  for (let tick = 0; tick < 20; tick++) simulation.update(.05);
  const interval = recorder.close("home")!;
  const endGame = await client.save();
  return { base: toSaveSnapshot(base), end: toSaveSnapshot(endGame), endGame,
    intervals: [{ ...interval, baseRevision: 1 }] };
};

describe("verifier game rules", () => {
  it("verifies an adopted revision with the server's copy and refuses one the server never issued", async () => {
    const chain = await play(await determinismIslandSave(), ISSUED);
    expect(chain.endGame.settlement.gameRules).toEqual(ISSUED);
    expect(await verifyCommandLogs({ ...chain, rules: SERVER_RULES })).toMatchObject({ status: "verified" });
    expect(await verifyCommandLogs({ ...chain, rules: { legacy: LEGACY_SIM_RULES } })).toMatchObject({
      mismatch: { kind: "command", reason: UNKNOWN_RULES_REVISION }, status: "mismatch" });
    // A later chain starts from the pinned base: the server resolves the base's revision too.
    const later = await play(chain.endGame);
    expect(await verifyCommandLogs({ ...later, rules: SERVER_RULES })).toMatchObject({ status: "verified" });
    expect(await verifyCommandLogs({ ...later, rules: {} })).toMatchObject({
      mismatch: { kind: "base", reason: UNKNOWN_RULES_REVISION }, status: "mismatch" });
  }, 120_000);

  it("a forged rules document under an issued revision does not verify", async () => {
    const forged: SimRules = { ...ISSUED, level: { kind: "fixed", level: 99 } };
    const chain = await play(await determinismIslandSave(), forged);
    expect(await verifyCommandLogs({ ...chain, rules: SERVER_RULES })).toMatchObject({
      mismatch: { kind: "snapshot" }, status: "mismatch" });
  }, 120_000);

  it("the player troop sight rule verifies pinned off and refuses a forged off under an issued revision", async () => {
    const chain = await play(await determinismIslandSave(), SIGHT_OFF);
    expect(chain.endGame.settlement.gameRules).toEqual(SIGHT_OFF);
    expect(await verifyCommandLogs({ ...chain, rules: SERVER_RULES })).toMatchObject({ status: "verified" });
    const forged = await play(await determinismIslandSave(), { ...ISSUED, playerTroopsSightOnly: false });
    expect(await verifyCommandLogs({ ...forged, rules: SERVER_RULES })).toMatchObject({
      mismatch: { kind: "snapshot" }, status: "mismatch" });
  }, 120_000);

  it("a legacy chain verifies with or without server rules", async () => {
    const chain = await play(await determinismIslandSave());
    expect("gameRules" in chain.endGame.settlement).toBe(false);
    expect(await verifyCommandLogs(chain)).toMatchObject({ status: "verified" });
    expect(await verifyCommandLogs({ ...chain, rules: {} })).toMatchObject({ status: "verified" });
  }, 120_000);
});

import { TICK_MS, TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { appendArchivedIslandProof, type ArchivedColonyCursor, archivedIslandProof, withArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import { createCommandLogRecorder } from "../../shared/settlement/command-log";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { IslandKey } from "../../shared/settlement/game-save-rows";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { archivedReliefSourceBlocker } from "./archived-relief-custody";

/** Current global quests and the filed island's native time are separate inputs, never a clock bump. */
export const openArchivedReliefIsland = async (baseline: GameSaveV1, questClock?: number) => {
  const currentDay = Date.parse(`${baseline.player?.questDay ?? ""}T12:00:00.000Z`);
  return (await import("./headless-replay")).createHeadlessIsland(baseline, false, false,
    Number.isFinite(questClock ?? currentDay) ? { questClock: () => questClock ?? currentDay } : {});
};

/** Record a zero-time reservation or a genuine native coverage interval from its exact source state. */
export const runArchivedReliefNative = async <T>(baseline: GameSaveV1, island: IslandKey,
  action: (simulation: SettlementSimulation) => T, target = baseline.savedAt, questClock = baseline.savedAt,
  colonyCursor?: ArchivedColonyCursor, sourceVersion = "0".repeat(40)) => {
  const problem = archivedReliefSourceBlocker(baseline, colonyCursor, target === baseline.savedAt ? questClock : undefined);
  if (problem) throw new Error(problem);
  if (!Number.isFinite(target) || target < baseline.savedAt) throw new Error("Invalid archived relief target time");
  const session = await openArchivedReliefIsland(baseline, questClock), { simulation } = session;
  const previous = archivedIslandProof(baseline)?.intervals.at(-1);
  if (previous && (previous.endTick !== simulation.gameTick() || previous.endChecksum !== simulation.counterChecksum()))
    throw new Error("The filed island changed outside its relief journal; visit it before collecting aid");
  const recorder = createCommandLogRecorder(simulation, { sourceVersion });
  recorder.open();
  const value = action(simulation);
  const ticks = Math.floor((target - baseline.savedAt) / TICK_MS + 1e-8);
  for (let tick = 0; tick < ticks; tick++) {
    simulation.update(TICK_SECONDS);
    if (tick && tick % 100 === 0) await new Promise<void>(done => setTimeout(done, 0));
  }
  const interval = recorder.close(island);
  if (!interval) throw new Error("The archived relief interval could not be recorded");
  const end = await session.save();
  const proof = appendArchivedIslandProof(baseline, end, island, interval, questClock, colonyCursor);
  return { save: withArchivedIslandProof(end, proof), value, proof, player: end.player,
    coverage: { from: baseline.savedAt, to: end.savedAt }, colonyCursor };
};

import { reliefPaymentProblem } from "../../shared/progression/relief-payment-validation";
import type { ArchivedColonyCursor, ArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import { addColonyNativeCoverage } from "../../shared/settlement/colony-native-economy";
import { replayCommandLog } from "../../shared/settlement/command-log-replay";
import { hashSettlementState } from "../../shared/settlement/settlement-state-hash";
import type { SaveSnapshot } from "../save-store/save-api-client";
import { fromSaveSnapshot } from "../save-store/save-snapshot";
import { archivedVerificationSnapshots } from "./archived-relief-verification";
import type { CommandLogVerification } from "./command-log-verify";
import { stageGameSession } from "./game-session";
import { createHeadlessIsland } from "./headless-replay";

/** Context contents/revisions are validated by the API before this bounded native replay. */
export const replayArchivedRelief = async (base: SaveSnapshot, end: SaveSnapshot,
  proof: ArchivedIslandProof, allowDebug: boolean): Promise<CommandLogVerification> => {
  const projected = archivedVerificationSnapshots(base, end, proof);
  const skipped = (reason: string): CommandLogVerification => ({ status: "skipped", ticks: 0, reason });
  if (!projected || !proof.contexts || proof.contexts.length !== proof.intervals.length)
    return skipped("The archived island chain has invalid ownership, context or chronological coverage");
  let save = fromSaveSnapshot(projected.base);
  const target = fromSaveSnapshot(projected.end);
  if (!save || !target) return skipped("The archived island has no saved state");
  let ticks = 0;
  let previousCursor: ArchivedColonyCursor | undefined;
  for (const [index, interval] of proof.intervals.entries()) {
    const context = proof.contexts[index]!;
    if (context.baseTick !== interval.baseTick || context.endTick !== interval.endTick || !Number.isFinite(context.questClock))
      return skipped("The archived island player context has a tick gap");
    const island = await createHeadlessIsland({ ...save, archipelago: undefined, player: structuredClone(context.player) }, false,
      allowDebug, { questClock: () => context.questClock });
    const result = replayCommandLog(island.simulation, interval, { rejectDebug: !allowDebug, untilEnd: true,
      validateCommand: entry => entry.command.name === "requestReliefCollection"
        ? reliefPaymentProblem(context.player, entry.command.args[0], island.simulation.reliefCollections()) : undefined });
    ticks += island.simulation.gameTick() - interval.baseTick;
    if (!result.ok) return { status: "mismatch", ticks, interval: index, island: proof.island,
      mismatch: result.mismatch, trail: island.simulation.randomAudit().draws(), trailTick: interval.endTick };
    const next = await island.save();
    const cursor = context.colonyCursor;
    if (cursor) {
      if (previousCursor && (cursor.expeditionId !== previousCursor.expeditionId ||
        cursor.conqueredAt !== previousCursor.conqueredAt || cursor.beforeNextOreShipAt !== previousCursor.afterNextOreShipAt ||
        JSON.stringify(cursor.beforeNativeEconomy) !== JSON.stringify(previousCursor.afterNativeEconomy)))
        return skipped("The archived colony shipment context has a continuity gap");
      if (cursor.afterNextOreShipAt !== cursor.beforeNextOreShipAt)
        return skipped("Native coverage cannot silently settle a colony shipment");
      const expected = interval.endTick > interval.baseTick
        ? addColonyNativeCoverage(cursor.beforeNativeEconomy, save.savedAt, next.savedAt)
        : cursor.beforeNativeEconomy;
      if (JSON.stringify(cursor.afterNativeEconomy) !== JSON.stringify(expected))
        return skipped("The archived colony native coverage differs from its replay");
    }
    previousCursor = cursor;
    save = { ...next, archipelago: save.archipelago };
  }
  const loaded = await stageGameSession({ ...target, archipelago: undefined });
  const actualLoaded = await stageGameSession({ ...save, archipelago: undefined });
  const actual = hashSettlementState({ settlement: actualLoaded.settlement, world: actualLoaded.map.world });
  const expected = hashSettlementState({ settlement: loaded.settlement, world: loaded.map.world });
  if (actual !== expected) return { status: "mismatch", ticks, island: proof.island,
    mismatch: { actual, expected, kind: "snapshot", tick: proof.intervals.at(-1)!.endTick } };
  const cursor = proof.contexts.at(-1)?.colonyCursor;
  if (cursor && target.archipelago?.colonies.find(colony => colony.expeditionId === cursor.expeditionId)?.nextOreShipAt !== cursor.afterNextOreShipAt)
    return skipped("The uploaded archived colony shipment cursor differs from its replay");
  if (cursor && JSON.stringify(target.archipelago?.colonies.find(colony => colony.expeditionId === cursor.expeditionId)?.nativeEconomy) !==
    JSON.stringify(cursor.afterNativeEconomy)) return skipped("The uploaded colony native coverage differs from its replay");
  return { status: "verified", ticks };
};

import { mapScriptHash } from "../../../../island-of-settlers-shared/src/script/hash";
import {
  type HeaderScriptRef, restoreScriptSnapshot, startScriptSnapshot, storeScriptSnapshot, type StoredScriptSnapshot
} from "../../../../island-of-settlers-shared/src/script/snapshot";
import { restoreSettlementScript, saveSettlementScript } from "../script-world/settlement-script";
import {
  type SavedSettlementScript, savedSettlementScriptProblem
} from "../script-world/settlement-script-save";
import type { WorldData } from "../world/world-data";
import type { SettlementContext } from "./settlement-types";

/**
 * The island's script snapshot (TRG1; trigger design §6.13, owner round 5 item 10): a home, colony, adventure or
 * campaign island copies its map's script when the map starts and keeps that copy until the map is restarted. The
 * save stores only the revision and hash while the island's own map header still has the same script. Islands whose
 * map has no script save nothing, so their saves and replay hashes are unchanged.
 */

const headerScriptOf = (world: WorldData): HeaderScriptRef | null =>
  world.script ? { script: world.script, scriptHash: mapScriptHash(world.script) } : null;

/** Map start: snapshot the map's script (no-op for a map without one). */
export const startIslandScript = (context: SettlementContext) => {
  const { script } = context.options.world;
  context.scriptSnapshot = script ? startScriptSnapshot(script) : undefined;
};

/** The save fields: snapshot and run state (TRG3a); both absent when the island runs no script. */
export const saveIslandScript = (
  context: SettlementContext
): { scriptRun?: SavedSettlementScript; scriptSnapshot?: StoredScriptSnapshot } => {
  const snapshot = context.scriptSnapshot;
  if (!snapshot) return {};
  return {
    ...saveSettlementScript(context),
    scriptSnapshot: storeScriptSnapshot(snapshot, headerScriptOf(context.options.world))
  };
};

/** Why a saved snapshot or run state cannot be used with this island's map, or null. */
export const islandScriptProblem = (stored: unknown, run: unknown, world: WorldData): string | null => {
  if (stored === undefined) return run === undefined ? null : "Script run state without a script";
  const restored = restoreScriptSnapshot(stored, headerScriptOf(world));
  return restored.ok ? savedSettlementScriptProblem(run) : restored.reason;
};

/** Restores a validated save's snapshot and run state (absent: the island runs no script). */
export const restoreIslandScript = (
  context: SettlementContext, stored: StoredScriptSnapshot | undefined, run: SavedSettlementScript | undefined
) => {
  if (stored === undefined) {
    context.scriptSnapshot = undefined;
    context.script = undefined;
    return;
  }
  const restored = restoreScriptSnapshot(stored, headerScriptOf(context.options.world));
  context.scriptSnapshot = restored.ok ? restored.snapshot : undefined;
  restoreSettlementScript(context, run);
};

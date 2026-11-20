import { createHash } from "node:crypto";

const MAIN_MARKER = "window.__islandReady = true;";
const RESTORE_MARKER = "initialState: restoredGame?.settlement,";
const CREATED_MARKER = "options.onCreated(settlement);";
const MAIN_HOOK = "window.__fullE2E = { world, camera, renderer, settlement };\n" + MAIN_MARKER;
const RESTORE_HOOK = "initialState: (window.__fullRestoreBoundary = " +
  "structuredClone(restoredGame?.settlement), restoredGame?.settlement),";
const FINGERPRINT_IMPORT = "import { fingerprintSemanticWorld as fullE2EFingerprintWorld } " +
  "from '/tools/e2e/full/semantic-world.ts';\n";
const CREATED_HOOK = "window.__fullRestoreResult = structuredClone(settlement.simulation.saveState());\n" +
  "window.__fullWorldRestoreIdentity = { seed: world.seed, cellsX: world.cellsX, cellsZ: world.cellsZ };\n" +
  "window.__fullWorldRestorePending = fullE2EFingerprintWorld(world, " +
  "{ buildings: window.__fullRestoreResult.buildings, roads: window.__fullRestoreResult.roads })" +
  ".then(value => { window.__fullWorldRestoreBoundary = value; });\n" + CREATED_MARKER;

export const observationHookHash = createHash("sha256")
  .update(MAIN_HOOK + RESTORE_HOOK + FINGERPRINT_IMPORT + CREATED_HOOK).digest("hex");

const replaceOnce = (source: string, marker: string, replacement: string) => {
  if (source.split(marker).length !== 2)
    throw new Error(`Observation boundary must occur exactly once: ${marker}`);
  return source.replace(marker, replacement);
};

/** Capture at the owning boot boundary without awaiting or changing settlement startup timing. */
export const observeSettlementBoot = (source: string) => FINGERPRINT_IMPORT +
  replaceOnce(replaceOnce(source, RESTORE_MARKER, RESTORE_HOOK), CREATED_MARKER, CREATED_HOOK);

export const observeMain = (source: string) => replaceOnce(source, MAIN_MARKER, MAIN_HOOK);

import { readFile } from "node:fs/promises";

import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";

/**
 * Compares the opt-in movement executor with the same island advanced by `moveActorStep` under the
 * corridor gate. Usage: tsx tools/analysis/movement-executor-compare.ts <save.json> [seconds]
 * Set INCLUDE_DEFAULT=1 to also show the ungated fixed reference (a different rule set: the gate
 * itself changes traffic, so the gated run is the parity reference).
 */
const [savePath, secondsArg = "600"] = process.argv.slice(2);
const seconds = Number(secondsArg);
if (!savePath) {
  console.error("usage: tsx tools/analysis/movement-executor-compare.ts <save.json> [game-seconds]");
  process.exit(2);
}
const source = JSON.parse(await readFile(savePath, "utf8")) as GameSaveV1;
const at = source.savedAt + seconds * 1000;

const run = async (options: { eventMovement?: boolean; corridorReservations?: boolean }) =>
  advanceOfflineGame(structuredClone(source), at, () => {}, {
    corridorReservations: true, exact: true, ...options
  });

const totals = (settlement: SettlementSaveV1) => ({
  logs: settlement.buildings.reduce((sum, building) => sum + (building.output.logs ?? 0), 0),
  planks: settlement.buildings.reduce((sum, building) => sum + (building.output.planks ?? 0), 0)
});

type Difference = { path: string; left: unknown; right: unknown };
const compare = (left: unknown, right: unknown, path: string, out: Difference[], limit = 40) => {
  if (out.length >= limit) return;
  if (Object.is(left, right)) return;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    out.push({ path, left, right });
    return;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    out.push({ path: `${path} (array mismatch)`, left: Array.isArray(left), right: Array.isArray(right) });
    return;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    compare((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key],
      Array.isArray(left) ? `${path}[${key}]` : `${path}.${key}`, out, limit);
    if (out.length >= limit) return;
  }
};

const fixed = await run({});
const event = await run({ eventMovement: true });
const report = (label: string, reference: SettlementSaveV1, eventSave: SettlementSaveV1) => {
  const differences: Difference[] = [];
  compare(reference, eventSave, "settlement", differences);
  console.log(label, { differences: differences.length, fixed: totals(reference), event: totals(eventSave) });
  for (const diff of differences.slice(0, 10))
    console.log(`  ${diff.path}: ${JSON.stringify(diff.left)} -> ${JSON.stringify(diff.right)}`);
  return differences.length;
};
const exact = report("corridor reference:", fixed.settlement, event.settlement);
if (process.env.INCLUDE_DEFAULT) {
  const plain = await run({ corridorReservations: false });
  console.log("default reference (different rules, not the parity target):");
  report("  ungated:", plain.settlement, event.settlement);
}
if (exact) process.exitCode = 1;

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { savedHomeBuilding } from "./helpers";

const [auditArgument, outputArgument] = process.argv.slice(2);
if (!auditArgument || !outputArgument)
  throw new Error("Usage: supported-save-continuation.ts <audit.json> <new-output-directory>");
const auditPath = resolve(auditArgument);
const output = resolve(outputArgument);
const audit = JSON.parse(await readFile(auditPath, "utf8")) as {
  reports: { label: string; copy: string; sourceHash: string; restored?: { ok: boolean } }[];
};
// Refuse to overwrite retained diagnostics or continued saves from an earlier run.
await mkdir(output);

/** Compare persisted physical stock/cargo, not incoming reservation promises counted as goods. */
const holdings = (state: SettlementSaveV1) => ({
  buildings: state.buildings.map(building => ({ uid: building.uid,
    input: building.input, output: building.output, inventory: building.inventory,
    constructionConsumed: building.constructionConsumed })),
  actors: state.actors.filter(actor => actor.ware || actor.tool || actor.demolitionCargo ||
    actor.consumed || actor.productionInputs)
    .map(actor => ({ uid: actor.uid, ware: actor.ware, wareUnits: actor.wareUnits,
      tool: actor.tool, demolitionCargo: actor.demolitionCargo, consumed: actor.consumed,
      productionInputs: actor.productionInputs })),
  naval: { ...state.naval, fleet: { ...state.naval.fleet,
    ships: state.naval.fleet.ships.map(ship => ({ id: ship.id, cargo: ship.cargo,
      cargoCount: ship.cargoCount })) } },
  trade: state.trade
});

const roundtrip = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  const roads = createRoadNetwork(loaded.map.world);
  const home = loaded.settlement.buildings.find(building => building.typeId === 0 || building.colonyHome);
  const simulation = createSettlementSimulation({ world: loaded.map.world, roads,
    homeBuilding: savedHomeBuilding(home), playerNation: loaded.settlement.playerNation });
  const restored = simulation.loadState(loaded.settlement);
  if (!restored.ok) throw new Error(restored.reason);
  const state = simulation.saveState();
  const originalHoldings = holdings(loaded.settlement), restoredHoldings = holdings(state);
  const holdingsUnchanged = isDeepStrictEqual(originalHoldings, restoredHoldings);
  return { holdingsUnchanged,
    holdingsDifference: holdingsUnchanged ? undefined : { before: originalHoldings, after: restoredHoldings },
    navalStateUnchanged: isDeepStrictEqual(loaded.settlement.naval, state.naval),
    idlePopulationUnchanged: state.settlers === loaded.settlement.settlers,
    storagePoolsUnchanged: isDeepStrictEqual(state.buildings.map(building => building.idleSettlers),
      loaded.settlement.buildings.map(building => building.idleSettlers)),
    people: simulation.population().people, births: state.settlerBirths,
    actors: state.actors.length };
};

const reports: unknown[] = [];
for (const [index, entry] of audit.reports.filter(entry => entry.restored?.ok).entries()) {
  try {
    const bytes = await readFile(entry.copy);
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    if (sourceHash !== entry.sourceHash) throw new Error("Preserved source hash mismatch");
    const original = JSON.parse(bytes.toString("utf8"));
    const source = (entry.label.endsWith("::baseline") ? original.baseline : original) as GameSaveV1;
    if (entry.label.includes("::") && !entry.label.endsWith("::baseline"))
      throw new Error("Nested island selector not implemented; never infer a different island");
    const before = await roundtrip(source);
    // Use the production offline runtime, including real wildlife/growth/felling hooks.
    const first = await advanceOfflineGame(source, source.savedAt + 30_000);
    const middle = await roundtrip(first);
    const second = await advanceOfflineGame(first, source.savedAt + 60_000);
    const after = await roundtrip(second);
    await writeFile(join(output, `continued-${index}.json`), JSON.stringify(second));
    const result = { label: entry.label, sourceHash, before, middle, after,
      seconds: 60, intervals: [30, 30],
      actorContinuations: source.settlement.actors.filter(actor => actor.visible).map(actor => {
        const next = second.settlement.actors.find(candidate => candidate.uid === actor.uid);
        return { uid: actor.uid, job: actor.job, before: { phase: actor.phase, timer: actor.timer,
          x: actor.x, z: actor.z }, after: next && { phase: next.phase, timer: next.timer,
          x: next.x, z: next.z } };
      }),
      populationMinusBirthsUnchanged: before.people - before.births === after.people - after.births,
      limitations: ["No browser/native scene or user interaction",
        "Holdings equality proves each zero-time reload, not arbitrary production-flow conservation",
        "No archived colony exists in these supported input fixtures"] };
    reports.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { label: entry.label, error: String(error) };
    reports.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(join(output, "report.json"), JSON.stringify({ auditPath, reports }, null, 2));
}

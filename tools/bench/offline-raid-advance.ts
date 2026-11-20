import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { ORDINARY_TROOP_TYPES } from "../../src/shared/settlement/military-combat-rules";
import { isHomeBuilding } from "../../src/shared/settlement/settlement-home";

/**
 * MIL-ASSAULT offline cost: wall time of the exact 120 s offline advance of the developed demo
 * (`public/demo/continued-0.json`), once untouched and once with computer foes standing in the
 * town, so enemies attack the villagers while the player is away.
 *
 * Each fixture runs on the exact lane (`exact`) and on the default fast economy lane (`fast`).
 * Usage: npx tsx tools/bench/offline-raid-advance.ts [foes=8] [seconds=120]
 */
const [foesArgument, secondsArgument] = process.argv.slice(2);
const FOES = Number(foesArgument ?? 8);
const SECONDS = Number(secondsArgument ?? 120);

const developedSave = () => {
  const url = new URL("../../public/demo/continued-0.json", import.meta.url);
  const save = JSON.parse(readFileSync(url, "utf8")) as GameSaveV1;
  if (save.runtime && typeof save.runtime === "object" && "animals" in save.runtime)
    delete (save.runtime as { animals?: unknown }).animals;
  save.archipelago = undefined;
  return save;
};

/** Computer foes on rings around the headquarters' access (deterministic order). */
const withFoes = async (save: GameSaveV1) => {
  const island = await createHeadlessIsland(save);
  const { simulation } = island;
  const home = simulation.buildings().find(isHomeBuilding)!;
  let placed = 0;
  for (let attempt = 0; attempt < 128 && placed < FOES; attempt++) {
    const angle = attempt * Math.PI / 12, radius = 6 + (attempt % 5);
    const point = { x: home.access.x + Math.cos(angle) * radius, z: home.access.z + Math.sin(angle) * radius };
    if (simulation.spawnMilitaryOpponent(point, ORDINARY_TROOP_TYPES[placed % 3]!, 1, 1) !== null) placed++;
  }
  return { placed, save: await island.save() };
};

const civilians = (save: GameSaveV1) => {
  const soldiers = new Set(save.settlement.military?.soldiers.map(soldier => soldier.actor) ?? []);
  return save.settlement.actors.filter(actor => !soldiers.has(actor.uid) && actor.job !== "Mount").length;
};

const timed = async (label: string, save: GameSaveV1, exact: boolean) => {
  const started = performance.now();
  const result = await advanceOfflineGame(structuredClone(save), save.savedAt + SECONDS * 1000, () => {},
    exact ? { exact: true, eventCore: false } : {});
  const wallMs = performance.now() - started;
  const soldiers = result.settlement.military?.soldiers ?? [];
  return { label, wallMs: Math.round(wallMs), civiliansBefore: civilians(save), civiliansAfter: civilians(result),
    enemiesAfter: soldiers.filter(soldier => (soldier.combat?.faction ?? 0) > 0).length,
    civilianDeaths: result.settlement.military?.combat?.civilianDeaths ?? 0,
    cartCrewsBefore: save.settlement.actors.filter(actor => actor.handcart).length,
    abandonedCartsAfter: result.settlement.abandonedHandcarts?.length ?? 0,
    digest: createHash("sha256").update(JSON.stringify(result.settlement.actors)).digest("hex").slice(0, 16) };
};

const quiet = developedSave(), raid = await withFoes(developedSave());
const runs = [];
for (const exact of [true, false]) {
  const lane = exact ? "exact" : "fast";
  runs.push(await timed(`${lane}:untouched`, quiet, exact),
    await timed(`${lane}:foes:${raid.placed}`, raid.save, exact));
}
console.log(JSON.stringify({ seconds: SECONDS, runs }, null, 2));

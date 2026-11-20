import { readFile } from "node:fs/promises";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import { valueStateKey } from "../../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";

const [savePath, secondsArg = "600"] = process.argv.slice(2);
if (!savePath) {
  console.error("usage: tsx tools/analysis/event-core-compare.ts <save.json> [game-seconds]");
  process.exit(2);
}
const seconds = Number(secondsArg);
if (!Number.isFinite(seconds) || seconds <= 0) {
  console.error("game-seconds must be a positive number");
  process.exit(2);
}

const source = JSON.parse(await readFile(savePath, "utf8")) as GameSaveV1;
const at = source.savedAt + seconds * 1000;

const fingerprint = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  return {
    e1: valueStateKey({ player: save.player, runtime: loaded.runtime, settlement: loaded.settlement }),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world })
  };
};

const run = async (label: string, options: { exact?: boolean; eventCore?: boolean }) => {
  const started = performance.now();
  const save = await advanceOfflineGame(structuredClone(source), at, progress => {
    if (progress.completedSeconds % 600 === 0) console.error(`${label}: ${progress.completedSeconds}/${seconds} s`);
  }, options);
  return { elapsed: performance.now() - started, fingerprint: await fingerprint(save), save };
};

const exact = await run("exact", { exact: true, eventCore: false });
const event = await run("event", { eventCore: true });
const exactE1 = exact.fingerprint.e1 === event.fingerprint.e1;
const exactE2 = exact.fingerprint.e2 === event.fingerprint.e2;

const resumeAt = at + 60_000;
const exactResume = await fingerprint(await advanceOfflineGame(structuredClone(exact.save), resumeAt,
  () => {}, { exact: true, eventCore: false }));
const eventResume = await fingerprint(await advanceOfflineGame(structuredClone(event.save), resumeAt,
  () => {}, { exact: true, eventCore: false }));
const resumeE1 = exactResume.e1 === eventResume.e1;
const resumeE2 = exactResume.e2 === eventResume.e2;

console.log(JSON.stringify({
  e1: exactE1,
  e2: exactE2,
  e3: resumeE1 && resumeE2,
  eventMs: Math.round(event.elapsed),
  exactMs: Math.round(exact.elapsed),
  fasterPercent: Math.round(100 * (exact.elapsed - event.elapsed) / exact.elapsed * 10) / 10,
  seconds
}, null, 2));
if (!exactE1 || !exactE2 || !resumeE1 || !resumeE2) process.exitCode = 1;

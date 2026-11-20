import { readFile } from "node:fs/promises";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import { valueStateKey } from "../../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";

const [savePath, secondsArg = "3600", chunkArg = "300", resumeArg = "60"] = process.argv.slice(2);
if (!savePath) {
  console.error("usage: tsx tools/analysis/checkpoint-compare.ts <save.json> [game-seconds] " +
    "[chunk-seconds] [resume-seconds]; EXACT=1 forces the exact lane");
  process.exit(2);
}
const seconds = Number(secondsArg), chunk = Number(chunkArg), resumeSeconds = Number(resumeArg);
if (![seconds, chunk, resumeSeconds].every(value => Number.isFinite(value) && value > 0)) {
  console.error("game-seconds, chunk-seconds and resume-seconds must be positive numbers");
  process.exit(2);
}

const source = JSON.parse(await readFile(savePath, "utf8")) as GameSaveV1;
const start = source.savedAt;

const stateOf = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  return { player: save.player, runtime: loaded.runtime, settlement: loaded.settlement, map: loaded.map };
};

const fingerprint = (state: Awaited<ReturnType<typeof stateOf>>) => ({
  e1: valueStateKey({ player: state.player, runtime: state.runtime, settlement: state.settlement }),
  e2: hashSettlementState({ runtime: state.runtime, settlement: state.settlement, world: state.map.world })
});

const timed = async <T>(fn: () => Promise<T>) => {
  const started = performance.now();
  const value = await fn();
  return { value, elapsed: performance.now() - started };
};

// Default follows the production duration policy. `EXACT=1` forces the fixed-tick reference at every
// checkpoint, so a long-gap split can be compared with the continuous exact replay.
const replayOptions = process.env.EXACT === "1" ? { exact: true, eventCore: false } : {};
const replay = (save: GameSaveV1, until: number) =>
  advanceOfflineGame(structuredClone(save), until, () => {}, replayOptions);

/** First few differing leaf paths between two loaded states, for diagnosis. */
const diffLimit = Math.max(1, Number(process.env.DIFF_LIMIT ?? 12));
const diffs = (a: unknown, b: unknown, path = "", out: string[] = []): string[] => {
  if (out.length >= diffLimit) return out;
  if (a === b) return out;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    out.push(`${path || "(root)"}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: array mismatch`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffs(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const key of keys) diffs((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key],
    path ? `${path}.${key}` : key, out);
  return out;
};

// Control: two uninterrupted runs from the same source must match, or the engine is not deterministic.
const a1 = await timed(() => replay(source, start + seconds * 1000));
const a2 = await timed(() => replay(source, start + seconds * 1000));
const a1State = await stateOf(a1.value), a2State = await stateOf(a2.value);
const a1Fp = fingerprint(a1State), a2Fp = fingerprint(a2State);
const deterministic = a1Fp.e1 === a2Fp.e1 && a1Fp.e2 === a2Fp.e2;

// A vs C: uninterrupted exact replay versus save/reload at every chunk boundary.
let chunkedSave = structuredClone(source), chunks = 0;
const chunked = await timed(async () => {
  while (chunks * chunk < seconds) {
    const step = Math.min(chunk, seconds - chunks * chunk);
    chunkedSave = await replay(chunkedSave, chunkedSave.savedAt + step * 1000);
    chunks++;
  }
  return chunkedSave;
});
const cState = await stateOf(chunked.value), cFp = fingerprint(cState);

// D: run both results forward with the same exact engine; catches state that only diverges later.
const resumeAt = start + (seconds + resumeSeconds) * 1000;
const a1ResumeState = await stateOf(await replay(a1.value, resumeAt));
const cResumeState = await stateOf(await replay(chunked.value, resumeAt));
const aResume = fingerprint(a1ResumeState);
const cResume = fingerprint(cResumeState);

const worldDiff = (a: Awaited<ReturnType<typeof stateOf>>["map"]["world"],
  b: Awaited<ReturnType<typeof stateOf>>["map"]["world"]) => {
  const out: string[] = [];
  for (const field of ["oreAmount", "heights", "fog"] as const) {
    const left = a[field], right = b[field];
    if (left.length !== right.length) out.push(`${field}.length: ${left.length} -> ${right.length}`);
    for (let i = 0; i < Math.min(left.length, right.length) && out.length < diffLimit; i++)
      if (left[i] !== right[i]) out.push(`${field}[${i}]: ${left[i]} -> ${right[i]}`);
  }
  if (a.props.count !== b.props.count) out.push(`props.count: ${a.props.count} -> ${b.props.count}`);
  for (const field of ["types", "x", "z", "phase"] as const) {
    const left = a.props[field], right = b.props[field];
    for (let i = 0; i < Math.min(a.props.count, b.props.count) && out.length < diffLimit; i++)
      if (left[i] !== right[i]) out.push(`props.${field}[${i}]: ${left[i]} -> ${right[i]}`);
  }
  return out;
};

const sameComponent = (key: "player" | "runtime" | "settlement") =>
  valueStateKey(a1State[key]) === valueStateKey(cState[key]);
const resumeSameComponent = (key: "player" | "runtime" | "settlement") =>
  valueStateKey(a1ResumeState[key]) === valueStateKey(cResumeState[key]);
const report = {
  seconds,
  chunks,
  chunkSeconds: chunk,
  deterministic,
  finalE1: a1Fp.e1 === cFp.e1,
  finalE2: a1Fp.e2 === cFp.e2,
  finalComponents: { player: sameComponent("player"), runtime: sameComponent("runtime"),
    settlement: sameComponent("settlement") },
  resumeE1: aResume.e1 === cResume.e1,
  resumeE2: aResume.e2 === cResume.e2,
  resumeComponents: { player: resumeSameComponent("player"), runtime: resumeSameComponent("runtime"),
    settlement: resumeSameComponent("settlement") },
  savedAtExact: a1.value.savedAt,
  savedAtChunked: chunked.value.savedAt,
  uninterruptedMs: Math.round(a1.elapsed),
  repeatMs: Math.round(a2.elapsed),
  chunkedMs: Math.round(chunked.elapsed),
  reloadOverheadMs: Math.round(chunked.elapsed - a2.elapsed),
  diffs: a1Fp.e1 === cFp.e1 ? [] : diffs({ player: a1State.player, runtime: a1State.runtime,
    settlement: a1State.settlement }, { player: cState.player, runtime: cState.runtime, settlement: cState.settlement }),
  worldDiffs: a1Fp.e2 === cFp.e2 ? [] : worldDiff(a1State.map.world, cState.map.world)
};
console.log(JSON.stringify(report, null, 2));
if (!deterministic || a1Fp.e1 !== cFp.e1 || a1Fp.e2 !== cFp.e2 ||
  aResume.e1 !== cResume.e1 || aResume.e2 !== cResume.e2) process.exitCode = 1;

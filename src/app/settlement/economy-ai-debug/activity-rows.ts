import { TICK_HZ } from "../../../../../island-of-settlers-shared/src/time/constants";
import { MAINTAIN_DONE, PLOT_ROTATIONS } from "../../../shared/settlement/economy-ai/constants";
import type { MaintainBackoff } from "../../../shared/settlement/economy-ai/maintain-state";
import {
  LISTED_REFUSED_PLOTS, PLANNER_STAGE_LABELS, REASON_NOT_RECORDED, SECONDS_PAD, SECONDS_PER_MINUTE
} from "./constants";
import { type EconomyAiLogEntry, plotKey } from "./probe-log";
import type { EconomyAiFactionInput, EconomyAiPlotMark, EconomyAiRow } from "./types";

/** A game tick as the game clock `m:ss`. */
export const formatClock = (tick: number) => {
  const seconds = Math.floor(tick / TICK_HZ);
  const rest = String(seconds % SECONDS_PER_MINUTE).padStart(SECONDS_PAD, "0");
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}:${rest}`;
};

/** Whole seconds from `now` until `tick`, never negative. */
export const secondsUntil = (tick: number, now: number) => Math.max(0, Math.ceil((tick - now) / TICK_HZ));

/** `until 3:20 (in 8 s)`, or `due now` once the tick passed. */
export const formatUntil = (tick: number, now: number) => {
  if (tick <= now) return "due now";
  return `until ${formatClock(tick)} (in ${secondsUntil(tick, now)} s)`;
};

/** A refusal's backoff: `×2 · until 3:20 (in 8 s)`; empty for a goal that was never refused. */
export const formatBackoff = ({ attempts, retryTick }: MaintainBackoff, now: number) => {
  if (attempts === undefined || retryTick === undefined) return "";
  return `×${attempts} · ${formatUntil(retryTick, now)}`;
};

/** The corner cell and quarter turn of a plot cache entry. */
const plotOfEntry = (entry: number, cellsX: number) => {
  const cell = Math.floor(entry / PLOT_ROTATIONS);
  return { rotation: entry % PLOT_ROTATIONS, x: cell % cellsX, z: Math.floor(cell / cellsX) };
};

const formatPlot = (entry: number, cellsX: number) => {
  const { rotation, x, z } = plotOfEntry(entry, cellsX);
  return `${x},${z} r${rotation}`;
};

/** The centre of an entry's turned plot, for its map mark. */
const plotCentre = ({ cellsX, footprint }: EconomyAiFactionInput, typeId: number, entry: number) => {
  const { rotation, x, z } = plotOfEntry(entry, cellsX), [width, depth] = footprint(typeId);
  const turned = rotation % 2 === 1;
  return { x: x + (turned ? depth : width) / 2, z: z + (turned ? width : depth) / 2 };
};

const joinParts = (parts: readonly string[]) => parts.filter(Boolean).join(" · ");

/** The goals, rebuilds and wall repairs that wait out a refusal. */
export const backoffRows = (input: EconomyAiFactionInput): EconomyAiRow[] => {
  const { buildingName, log, snapshot, tick } = input, rows: EconomyAiRow[] = [];
  for (const entry of snapshot.develop?.backoffs ?? []) {
    const typeId = log?.report?.goals.find(goal => goal.id === entry.goal)?.typeId;
    const reason = typeId === undefined ? undefined : log?.goalRefusals.get(typeId)?.detail;
    rows.push({ label: `Goal ${entry.goal}`,
      value: joinParts([formatBackoff(entry, tick), reason ?? REASON_NOT_RECORDED]) });
  }
  for (const entry of snapshot.maintain?.rebuilds ?? []) {
    if (entry.attempts === undefined) continue;
    rows.push({ label: `Rebuild ${buildingName(entry.typeId)}`, value: formatBackoff(entry, tick) });
  }
  for (const entry of snapshot.maintain?.repairs ?? [])
    rows.push({ label: `Repair #${entry.uid}`, value: formatBackoff(entry, tick) });
  return rows;
};

const newestEntry = <Key>(entries: ReadonlyMap<Key, EconomyAiLogEntry>) => {
  let newest: [Key, EconomyAiLogEntry] | undefined;
  for (const pair of entries) if (!newest || pair[1].tick >= newest[1].tick) newest = pair;
  return newest;
};

const pendingValue = ({ buildingName, cellsX, snapshot }: EconomyAiFactionInput) => {
  const pending = snapshot.planner?.pending;
  if (!pending) return "idle";
  const { candidates, stage, typeId } = pending;
  return joinParts([buildingName(typeId), PLANNER_STAGE_LABELS[stage] ?? `stage ${stage}`,
    `plot ${formatPlot(candidates[0]!, cellsX)}`, `${candidates.length} waiting`]);
};

const refusedPlotRows = ({ buildingName, cellsX, log, snapshot, tick }: EconomyAiFactionInput): EconomyAiRow[] => {
  const memo = [...snapshot.planner?.memo ?? []].sort((first, second) => second.expires - first.expires);
  return memo.slice(0, LISTED_REFUSED_PLOTS).map(({ entry, expires, typeId }) => ({
    label: `${buildingName(typeId)} @ ${formatPlot(entry, cellsX)}`,
    value: joinParts([log?.plotReasons.get(plotKey(typeId, entry)) ?? REASON_NOT_RECORDED,
      `forgets in ${secondsUntil(expires, tick)} s`])
  }));
};

/** The build planner: the waiting staged step, the last refused goal and the negative memo's plots. */
export const plannerRows = (input: EconomyAiFactionInput): EconomyAiRow[] => {
  const { buildingName, log, snapshot } = input;
  const rows: EconomyAiRow[] = [{ label: "Pending step", value: pendingValue(input) }];
  const refusal = log && newestEntry(log.goalRefusals);
  if (refusal) rows.push({ label: "Last refused goal",
    value: joinParts([buildingName(refusal[0]), refusal[1].detail, `at ${formatClock(refusal[1].tick)}`]) });
  const remembered = snapshot.planner?.memo?.length ?? 0;
  rows.push({ label: "Refused plots", value: `${remembered} remembered` });
  return [...rows, ...refusedPlotRows(input)];
};

const lastActivity = (entry: EconomyAiLogEntry | undefined, done: (detail: string) => string) => {
  if (!entry) return "nothing recorded";
  return `last: ${done(entry.detail)} at ${formatClock(entry.tick)}`;
};

const outcome = (detail: string, success: string) =>
  (detail === MAINTAIN_DONE ? success : `refused (${detail})`);

/** `maintain`: what waits to be rebuilt or repaired, and the last rebuild, re-garrison and repair. */
export const maintainRows = ({ log, snapshot }: EconomyAiFactionInput): EconomyAiRow[] => {
  const rebuilds = snapshot.maintain?.rebuilds?.length ?? 0, repairs = snapshot.maintain?.repairs?.length ?? 0;
  const activity = log?.maintain ?? {};
  return [
    { label: "Rebuild", value: joinParts([`${rebuilds} waiting`,
      lastActivity(activity.rebuild, detail => outcome(detail, "site placed"))]) },
    { label: "Re-garrison", value: lastActivity(activity.garrison, detail => `${detail} soldiers sent`) },
    { label: "Repair", value: joinParts([`${repairs} in backoff`,
      lastActivity(activity.repair, detail => outcome(detail, "repairer sent"))]) }
  ];
};

/** The map marks: every refused plot the memo holds and the waiting placement's candidates in rank order. */
export const plotMarks = (input: EconomyAiFactionInput): EconomyAiPlotMark[] => {
  const { log, snapshot } = input, marks: EconomyAiPlotMark[] = [];
  for (const { entry, typeId } of snapshot.planner?.memo ?? [])
    marks.push({ kind: "refused", label: log?.plotReasons.get(plotKey(typeId, entry)) ?? "refused",
      ...plotCentre(input, typeId, entry) });
  const pending = snapshot.planner?.pending;
  pending?.candidates.forEach((entry, rank) => {
    marks.push({ kind: "candidate", label: `#${rank + 1}`, ...plotCentre(input, pending.typeId, entry) });
  });
  return marks;
};

import type { AiPosture } from "@shared/catalog";
import { buildProgramOf, DEFAULT_BUILD_PROGRAM_STYLE } from "@shared/catalog/ai/build-programs";

import { TICK_HZ } from "../../../../../island-of-settlers-shared/src/time/constants";
import { DEVELOP_MODE, FACTION_AI_LAYERS, MAX_OPEN_SITES } from "../../../shared/settlement/economy-ai/constants";
import type {
  DevelopGoalReport, DevelopGoalStatus, DevelopGoalTerms
} from "../../../shared/settlement/economy-ai/develop-diagnostics";
import { unpackBitSet } from "../../../shared/settlement/save-cell-codecs";
import { NO_BONUS_PERCENT } from "../../../shared/world/constants";
import type { ScenarioFactionAiBonus } from "../../../shared/world/scenario-faction-ai";
import {
  backoffRows, formatClock, formatUntil, maintainRows, plannerRows, plotMarks, secondsUntil
} from "./activity-rows";
import {
  BONUS_LABELS, FACTOR_SCALE, GOAL_STATUS_RANK, LAYER_INITIALS, SCORE_DIGITS, SCORE_SCALE, TOP_GOALS
} from "./constants";
import type {
  EconomyAiFactionInput, EconomyAiFactionView, EconomyAiGoalRow, EconomyAiRow, EconomyAiViewInput
} from "./types";

/** A score term in weight points (the simulation keeps hundredths). */
const formatScore = (hundredths: number) => (hundredths / SCORE_SCALE).toFixed(SCORE_DIGITS);

const formatPenalty = (hundredths: number) => (hundredths ? `−${formatScore(hundredths)}` : "0");

const formatThreat = ({ health, soldiers }: EconomyAiFactionInput["snapshot"]["threat"]) => {
  if (!soldiers) return "none known";
  return `${soldiers} soldiers known (health ${Math.round(health)})`;
};

const formatLayers = (values: readonly number[], format: (value: number) => string) =>
  values.map((value, layer) => `${LAYER_INITIALS[layer] ?? FACTION_AI_LAYERS[layer]} ${format(value)}`).join(" · ");

/** The map's handicap (`ScenarioFactionAi.bonus`, EAI5a): `construction +50 % · training +100 %`, or none. */
export const handicapText = (bonus: Readonly<ScenarioFactionAiBonus> | undefined) => {
  const parts = BONUS_LABELS.flatMap(key => {
    const percent = bonus?.[key] ?? NO_BONUS_PERCENT;
    return percent === NO_BONUS_PERCENT ? [] : [`${key} +${percent - NO_BONUS_PERCENT} %`];
  });
  return parts.length ? parts.join(" · ") : "none";
};

/** Mode, style, level, handicap, threat and the decision clocks of the four layers (S, P, E, M). */
export const settingRows = ({ authored, log, snapshot, tick }: EconomyAiFactionInput): EconomyAiRow[] => {
  const { decisions, due, level, mode, paused, style, threat } = snapshot;
  const rows: EconomyAiRow[] = [{ label: "Mode", value: paused ? `${mode} (paused)` : mode }];
  if (mode === DEVELOP_MODE) {
    rows.push({ label: "Style", value: style ?? authored?.style ?? DEFAULT_BUILD_PROGRAM_STYLE });
    rows.push({ label: "Posture", value: log?.report?.posture ?? "not decided yet" });
  }
  rows.push({ label: "Level", value: level ?? authored?.level ?? "island difficulty" });
  rows.push({ label: "Handicap", value: handicapText(authored?.bonus) });
  rows.push({ label: "Threat", value: formatThreat(threat) });
  rows.push({ label: "Decisions", value: formatLayers(decisions, String) });
  rows.push({ label: "Next in", value: formatLayers(due, value => `${secondsUntil(value, tick)} s`) });
  return rows;
};

const scoredState = ({ score, threat }: DevelopGoalTerms) => {
  if (score > 0) return "payable";
  return threat > 0 ? "threat near" : "score ≤ 0";
};

/** `no stock: plank 2/4` (the first ware the free stock does not pay: have/need). */
const unpaidState = ({ shortage }: DevelopGoalTerms) => {
  if (!shortage) return "no stock";
  return `no stock: ${shortage.ware} ${shortage.have}/${shortage.need}`;
};

const GOAL_STATES: Record<DevelopGoalStatus, (goal: DevelopGoalTerms) => string> = {
  backoff: () => "backoff",
  prerequisite: () => "prerequisite",
  scored: scoredState,
  tool: () => "no tool",
  unpaid: unpaidState,
  unscored: () => "past quota"
};

/** The best `TOP_GOALS` goals of the last strategic decision (stable: ties keep program order). */
export const topGoals = (report: DevelopGoalReport | undefined) => {
  if (!report) return [];
  const ranked = report.goals.map((goal, order) => ({ goal, order }));
  ranked.sort((first, second) => GOAL_STATUS_RANK[first.goal.status] - GOAL_STATUS_RANK[second.goal.status] ||
    second.goal.score - first.goal.score || first.order - second.order);
  return ranked.slice(0, TOP_GOALS).map(entry => entry.goal);
};

const goalRow = (goal: DevelopGoalTerms, committed: string | undefined, buildingName: (typeId: number) => string
): EconomyAiGoalRow => ({
  committed: goal.id === committed,
  cost: formatPenalty(goal.cost),
  deficit: String(goal.deficit),
  factor: `×${(goal.factor / FACTOR_SCALE).toFixed(SCORE_DIGITS)}`,
  id: goal.id,
  score: formatScore(goal.score),
  state: GOAL_STATES[goal.status](goal),
  threat: formatPenalty(goal.threat),
  title: buildingName(goal.typeId),
  weight: String(goal.weight)
});

const goalsNote = ({ log, snapshot }: EconomyAiFactionInput) => {
  if (snapshot.mode !== DEVELOP_MODE) return "Only a develop faction scores build goals.";
  if (!log?.report || log.reportTick === undefined) return "Scores appear at the next strategic decision (≤ 10 s).";
  return `Scored at ${formatClock(log.reportTick)}, posture ${log.report.posture}.`;
};

const committedGoalText = ({ snapshot }: EconomyAiFactionInput) => {
  const goal = snapshot.develop?.goal;
  if (!goal) return "none";
  return `${goal.id} (wants ${goal.target})`;
};

const firstWithStatus = (report: DevelopGoalReport, status: DevelopGoalStatus) =>
  report.goals.find(goal => goal.status === status);

/** Why a develop faction holds no goal, from the last strategic decision's report. */
const idleGoalReasons = (report: DevelopGoalReport) => {
  if (!report.goals.length) return ["Program complete: no goal misses a building."];
  const reasons: string[] = [];
  if (report.openSites >= MAX_OPEN_SITES)
    reasons.push(`${report.openSites} construction sites open: they are finished first.`);
  const unpaid = firstWithStatus(report, "unpaid");
  if (unpaid) reasons.push(`${unpaid.id}: ${unpaidState(unpaid)}.`);
  const threatened = report.goals.find(goal => goal.status === "scored" && goal.score <= 0 && goal.threat > 0);
  if (threatened) reasons.push(`${threatened.id}: threat near (score ${formatScore(threatened.score)}).`);
  const prerequisite = firstWithStatus(report, "prerequisite");
  if (prerequisite) reasons.push(`${prerequisite.id}: a prerequisite goal is not finished.`);
  const toolless = firstWithStatus(report, "tool");
  if (toolless) reasons.push(`${toolless.id}: no tool for its worker in stock.`);
  return reasons;
};

const backoffWaits = ({ log, snapshot, tick }: EconomyAiFactionInput) =>
  (snapshot.develop?.backoffs ?? []).filter(entry => entry.retryTick > tick).map(entry => {
    const typeId = log?.report?.goals.find(goal => goal.id === entry.goal)?.typeId;
    const reason = typeId === undefined ? undefined : log?.goalRefusals.get(typeId)?.detail;
    const cause = reason ? ` (${reason.toLowerCase()})` : "";
    return `Backoff ${formatUntil(entry.retryTick, tick)}: ${entry.goal}${cause}.`;
  });

/** Why the faction is not building right now: "no stock", "no plot", "threat near", "backoff until t". */
export const waitReasons = (input: EconomyAiFactionInput) => {
  const { log, snapshot } = input;
  if (snapshot.paused) return ["Paused by a script: no decisions."];
  if (snapshot.mode === "none") return ["Mode none: no decisions."];
  const waits = backoffWaits(input);
  if (snapshot.threat.soldiers > 0) waits.push(`Threat known: ${formatThreat(snapshot.threat)}.`);
  if (snapshot.mode !== DEVELOP_MODE || snapshot.develop?.goal) return waits;
  if (!log?.report) return [...waits, "No goal yet: waiting for the next strategic decision."];
  return [...waits, ...idleGoalReasons(log.report)];
};

const countBits = (bytes: Uint8Array) => {
  let count = 0;
  for (const byte of bytes) for (let bits = byte; bits; bits &= bits - 1) count++;
  return count;
};

/** The posture's stock targets of the wares the program lists, then the default for every other ware. */
const stockTargetText = (style: string, posture: AiPosture) => {
  const { default: fallback, wares } = buildProgramOf(style).stock;
  const listed = Object.keys(wares).sort().map(ware => `${ware} ${wares[ware]![posture]}`);
  return [...listed, `others ${fallback[posture]}`].join(" · ");
};

const depositsText = (deposits: readonly number[] | undefined, surveyCursor = 0) => {
  const known = deposits?.length ? `zones ${deposits.join(", ")}` : "none surveyed";
  return surveyCursor ? `${known} · last tried zone ${surveyCursor}` : known;
};

/**
 * The economy manager of a develop faction (EAI3c): the stock targets of its posture, its rolling building cursor,
 * the cells it has discovered and its geologist's surveyed deposits. Paused producers show on the buildings.
 */
const managerRows = ({ authored, snapshot }: EconomyAiFactionInput): EconomyAiRow[] => {
  if (snapshot.mode !== DEVELOP_MODE) return [];
  const develop = snapshot.develop ?? {};
  const posture: AiPosture = develop.fortify ? "fortify" : "grow";
  const style = snapshot.style ?? authored?.style ?? DEFAULT_BUILD_PROGRAM_STYLE;
  const discovered = develop.discovered && unpackBitSet(develop.discovered, develop.discovered.length);
  return [
    { label: `Stock targets (${posture})`, value: stockTargetText(style, posture) },
    { label: "Examined next", value: develop.cursor ? `from building #${develop.cursor}` : "from the first building" },
    { label: "Discovered", value: `${discovered ? countBits(discovered) : 0} cells` },
    { label: "Geologist", value: depositsText(develop.deposits, develop.surveyCursor) }
  ];
};

const factionView = (input: EconomyAiFactionInput): EconomyAiFactionView => {
  const { buildingName, log, snapshot } = input;
  return {
    backoffs: backoffRows(input),
    faction: snapshot.faction,
    goal: committedGoalText(input),
    goals: topGoals(log?.report).map(goal => goalRow(goal, snapshot.develop?.goal?.id, buildingName)),
    goalsNote: goalsNote(input),
    maintain: maintainRows(input),
    manager: managerRows(input),
    planner: plannerRows(input),
    plots: plotMarks(input),
    setting: settingRows(input),
    title: `Faction ${snapshot.faction}`,
    waits: waitReasons(input)
  };
};

/** The "why" panel's view model: one entry per AI faction, ascending (the snapshots' order). */
export const getEconomyAiView = ({ authored, logOf, snapshots, ...shared }: EconomyAiViewInput) =>
  snapshots.map(snapshot => factionView({
    ...shared, authored: authored.find(entry => entry.faction === snapshot.faction), log: logOf(snapshot.faction),
    snapshot
  }));

/** The game clock shown in the window's status line. */
export const formatGameClock = (tick: number) => `Game time ${formatClock(tick)} (tick ${tick}, ${TICK_HZ} Hz)`;

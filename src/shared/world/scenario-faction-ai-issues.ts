import { fieldPath, indexPath } from "../../../../island-of-settlers-shared/src/validation/index";
import {
  FACTION_AI_BONUS_PERCENT_RANGE, FACTION_AI_DEVELOP_MIN_MAP_SIDE,
  FACTION_AI_PATH, ISLAND_PEOPLE_TARGET, MAX_DEVELOP_FACTIONS
} from "./constants";
import type { MapScenario } from "./map-scenario";
import {
  activeFactionAi, factionAiDevelopSoldierLimit, factionAiInvalidPaths, type FactionAiMode,
  factionAiPopulationLimit, type ScenarioFactionAi
} from "./scenario-faction-ai";
import { scenarioGarrison } from "./scenario-garrison";
import { startTroopTotal } from "./scenario-start-troops";

/**
 * Validation issues of `MapScenario.factionAi` (enemy economy AI plan §2.2). `code` is the stable message key,
 * `path` points at the field and `params` fill the English template; errors block Ready and Play, warnings never
 * do. Issues come in a fixed order: errors in list order first, then warnings.
 */
export const FACTION_AI_ISSUE_MESSAGES = {
  developOnSmallMap: {
    en: "Computer faction {faction} develops an economy on a map smaller than {side}×{side} cells."
  },
  developWithoutSettlers: { en: "Computer faction {faction}: the develop mode needs start settlers." },
  duplicateFaction: { en: "{path}: computer faction {faction} is listed more than once." },
  factionNeverActs: {
    en: "Computer faction {faction} has no units, no buildings and no start, so its AI would never act."
  },
  handicap: { en: "Handicap: AI +{percent} % (computer faction {faction})." },
  invalidField: { en: "{path}: invalid value." },
  maintainWithoutStock: {
    en: "Computer faction {faction} maintains with an empty start stock: it can re-garrison but never rebuild."
  },
  multipleDevelopFactions: {
    en: "{count} computer factions develop an economy; a map may have {max}, beside any number that maintain."
  },
  onHomeMap: { en: "A home map is peaceful: it cannot have computer faction AI." },
  peopleAboveIslandTarget: {
    en: "The computer factions' people limits and the player's start add up to {people}; one island is planned " +
      "for {target} people."
  },
  styleWithoutDevelop: { en: "{path}: a style applies to the develop mode only." }
} as const;

export type FactionAiIssueCode = keyof typeof FACTION_AI_ISSUE_MESSAGES;
export type FactionAiIssueSeverity = "error" | "warning";
type FactionAiIssueParams = Readonly<Record<string, string | number>>;

export interface FactionAiIssue {
  code: FactionAiIssueCode;
  params: FactionAiIssueParams;
  path: string;
  severity: FactionAiIssueSeverity;
}

/** The scenario fields the checks read; the shape scope reads `factionAi` and `kind` only. */
export type FactionAiSource = { factionAi?: unknown; kind?: unknown } &
  Partial<Pick<MapScenario, "buildings" | "settlers" | "startSetup" | "startTroops" | "units">>;

/**
 * `shape` is the map-file guard's part (`isMapScenario`); `ready` adds the Ready/Play rules of a scenario that
 * passed the guard. Absent map cells skip the map-size warning.
 */
export interface FactionAiCheckContext {
  cellsX?: number;
  cellsZ?: number;
  scope?: "ready" | "shape";
}

const issue = (
  severity: FactionAiIssueSeverity, code: FactionAiIssueCode, path: string, params: FactionAiIssueParams = {}
): FactionAiIssue => ({ code, params, path, severity });

const entryShapeIssues = (entry: ScenarioFactionAi, index: number, entries: readonly ScenarioFactionAi[]) => {
  const issues: FactionAiIssue[] = [], path = indexPath(FACTION_AI_PATH, index), { faction } = entry;
  if (entries.findIndex(other => other.faction === faction) < index)
    issues.push(issue("error", "duplicateFaction", fieldPath(path, "faction"), { faction }));
  if (entry.style !== undefined && entry.mode !== "develop")
    issues.push(issue("error", "styleWithoutDevelop", fieldPath(path, "style")));
  return issues;
};

const shapeIssues = ({ factionAi, kind }: FactionAiSource): FactionAiIssue[] => {
  if (factionAi === undefined) return [];
  const invalidPaths = factionAiInvalidPaths(factionAi, FACTION_AI_PATH);
  if (invalidPaths.length) return invalidPaths.map(path => issue("error", "invalidField", path));
  const homeIssues = kind === "home" ? [issue("error", "onHomeMap", FACTION_AI_PATH)] : [];
  return [...homeIssues, ...(factionAi as ScenarioFactionAi[]).flatMap(entryShapeIssues)];
};

const garrisonSoldiers = (source: FactionAiSource, faction: number) => (source.buildings ?? [])
  .filter(building => building.faction === faction)
  .reduce((sum, building) => sum + startTroopTotal(scenarioGarrison(building)), 0);

const authoredSoldiers = (source: FactionAiSource, faction: number) =>
  (source.units ?? []).filter(unit => unit.faction === faction).length + garrisonSoldiers(source, faction);

const ownsAuthoredObjects = (source: FactionAiSource, faction: number) =>
  [...source.units ?? [], ...source.buildings ?? []].some(entry => entry.faction === faction);

const startSoldiers = (entry: ScenarioFactionAi) => startTroopTotal(entry.start?.soldiers ?? []);

/** A maintain faction keeps its authored soldiers plus its start reserve (plan §6.3). */
const soldierLimit = (entry: ScenarioFactionAi, source: FactionAiSource, mode: FactionAiMode) => {
  if (mode === "develop") return factionAiDevelopSoldierLimit(entry);
  if (entry.limits?.soldiers !== undefined) return entry.limits.soldiers;
  return authoredSoldiers(source, entry.faction) + startSoldiers(entry);
};

/** The people an AI faction may have while it plays `mode`; a `none` faction has no AI people. */
const factionPeople = (entry: ScenarioFactionAi, source: FactionAiSource, mode: FactionAiMode) =>
  mode === "none" ? 0 : factionAiPopulationLimit(entry, mode) + soldierLimit(entry, source, mode);

const playerStartPeople = ({ settlers, startSetup, startTroops }: FactionAiSource) =>
  startSetup === "off" ? 0 : (settlers ?? 0) + startTroopTotal(startTroops ?? []);

/**
 * The island's people: every AI faction's limits and the player's start. `modeOf` names the mode each faction is
 * counted at (default: its authored one), so a script's mode switch is measured with the map's own rule.
 */
export const islandAiPeople = (
  source: FactionAiSource, modeOf: (entry: ScenarioFactionAi) => FactionAiMode = entry => entry.mode
) => ((source.factionAi ?? []) as readonly ScenarioFactionAi[]).reduce(
  (sum, entry) => sum + factionPeople(entry, source, modeOf(entry)), playerStartPeople(source));

const peopleIssues = (active: readonly ScenarioFactionAi[], source: FactionAiSource) => {
  if (!active.length) return [];
  const people = islandAiPeople(source);
  if (people <= ISLAND_PEOPLE_TARGET) return [];
  return [issue("error", "peopleAboveIslandTarget", FACTION_AI_PATH, { people, target: ISLAND_PEOPLE_TARGET })];
};

const hasStartStock = (entry: ScenarioFactionAi) => Object.values(entry.start?.stock ?? {}).some(amount => amount > 0);

/** The largest authored bonus above "no handicap", in percent points; 0 without one. */
const handicapPercent = ({ bonus }: ScenarioFactionAi) => {
  const none = FACTION_AI_BONUS_PERCENT_RANGE[0];
  return Math.max(bonus?.construction ?? none, bonus?.production ?? none, bonus?.training ?? none) - none;
};

const isSmallMap = ({ cellsX, cellsZ }: FactionAiCheckContext) => cellsX !== undefined && cellsZ !== undefined &&
  cellsX * cellsZ < FACTION_AI_DEVELOP_MIN_MAP_SIDE * FACTION_AI_DEVELOP_MIN_MAP_SIDE;

const entryErrors = (entry: ScenarioFactionAi, path: string, source: FactionAiSource) => {
  const issues: FactionAiIssue[] = [], { faction } = entry;
  if (entry.mode === "develop" && !entry.start?.settlers)
    issues.push(issue("error", "developWithoutSettlers", fieldPath(path, "start.settlers"), { faction }));
  if (!entry.start && !ownsAuthoredObjects(source, faction))
    issues.push(issue("error", "factionNeverActs", path, { faction }));
  return issues;
};

const entryWarnings = (entry: ScenarioFactionAi, path: string, context: FactionAiCheckContext) => {
  const issues: FactionAiIssue[] = [], { faction } = entry, percent = handicapPercent(entry);
  if (entry.mode === "develop" && isSmallMap(context)) issues.push(issue("warning", "developOnSmallMap",
    fieldPath(path, "mode"), { faction, side: FACTION_AI_DEVELOP_MIN_MAP_SIDE }));
  if (entry.mode === "maintain" && !hasStartStock(entry))
    issues.push(issue("warning", "maintainWithoutStock", fieldPath(path, "start.stock"), { faction }));
  if (percent > 0) issues.push(issue("warning", "handicap", fieldPath(path, "bonus"), { faction, percent }));
  return issues;
};

const developCountIssues = (active: readonly ScenarioFactionAi[]) => {
  const count = active.filter(entry => entry.mode === "develop").length;
  if (count <= MAX_DEVELOP_FACTIONS) return [];
  return [issue("error", "multipleDevelopFactions", FACTION_AI_PATH, { count, max: MAX_DEVELOP_FACTIONS })];
};

/** The Ready/Play rules that need no faction-scoped economy state (the depot and plot rules arrive with P1). */
const readyIssues = (source: FactionAiSource, context: FactionAiCheckContext) => {
  const entries = (source.factionAi ?? []) as readonly ScenarioFactionAi[], active = activeFactionAi(entries);
  const activePath = (entry: ScenarioFactionAi) => indexPath(FACTION_AI_PATH, entries.indexOf(entry));
  return [
    ...active.flatMap(entry => entryErrors(entry, activePath(entry), source)),
    ...developCountIssues(active),
    ...peopleIssues(active, source),
    ...active.flatMap(entry => entryWarnings(entry, activePath(entry), context))
  ];
};

/** Shape errors alone when `factionAi` is malformed or the scope is `shape`, else the Ready rules. */
export const checkFactionAi = (source: FactionAiSource, context: FactionAiCheckContext = {}): FactionAiIssue[] => {
  const issues = shapeIssues(source);
  return issues.length || context.scope === "shape" ? issues : readyIssues(source, context);
};

export const hasFactionAiErrors = (issues: readonly FactionAiIssue[]) =>
  issues.some(entry => entry.severity === "error");

/** Absent, or a well-shaped list on a map kind that may have computer faction AI (the `isMapScenario` part). */
export const validScenarioFactionAi = (source: FactionAiSource) =>
  !hasFactionAiErrors(checkFactionAi(source, { scope: "shape" }));

/** The issue's English message with `{name}` placeholders filled. */
export const formatFactionAiIssue = (entry: FactionAiIssue) => {
  const values: FactionAiIssueParams = { ...entry.params, path: entry.path };
  return FACTION_AI_ISSUE_MESSAGES[entry.code].en
    .replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder));
};

/** The English messages of the errors alone: what `validateMapScenario` refuses Play for. */
export const factionAiErrorMessages = (source: FactionAiSource, context: FactionAiCheckContext = {}) =>
  checkFactionAi(source, context).filter(entry => entry.severity === "error").map(formatFactionAiIssue);

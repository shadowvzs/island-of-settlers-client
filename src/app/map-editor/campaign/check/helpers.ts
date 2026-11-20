import type { I18n } from "@lingui/core";

import {
  type CampaignIssue, formatCampaignIssue
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-issues";
import type { Campaign, CampaignMap } from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { formatScriptIssue, type ScriptIssue } from "../../../../../../island-of-settlers-shared/src/script/issues";
import { translateMessage } from "../../../../shared/i18n/translate";
import type { ScriptDeepLink } from "../../script/deep-link";
import { parseIssuePath } from "../../script/paths";
import type { CampaignMapCheck, CampaignReadyReport } from "../campaign-editor-state";
import { reportTotals } from "../campaign-readiness";
import { type CampaignTextEntry, collectCampaignTexts } from "../campaign-texts";
import {
  CHECK_CATEGORIES, CHECK_PATH_CODES, CHECK_REFERENCE_CODES, CHECK_REWARD_CODES, CHECK_REWARD_PATH,
  CHECK_TRANSLATION_CODES,
  type CheckCategory, MAP_SETTINGS_FIELDS, STORY_KINDS, STORY_TRIGGER, type WorkspaceTabId
} from "../constants";
import { displayText } from "../helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "../messages";
import { workspaceTabLabels } from "../workspace-helpers";
import { graphIssueMapId, namedGraphParams } from "./graph-issues";
import { recordPathLabel, scriptIssueLink, scriptPathLabel, type ScriptPathNames } from "./path-labels";

/** Where a Check entry leads: a section tab (optionally one translation table cell) or the 3D map editor. */
export type CheckJumpTarget =
  | { kind: "mapEditor"; mapId: string; script?: ScriptDeepLink }
  | { kind: "tab"; language?: string; mapId: string | null; tab: WorkspaceTabId; textId?: string };

/** Which validator reported an issue: a campaign/map record check, a map file's script check, or reward lines. */
type CheckOrigin = "record" | "reward" | "script";
type CheckIssue = (CampaignIssue | ScriptIssue) & { origin: CheckOrigin };

export interface CheckEntry {
  category: CheckCategory;
  id: string;
  message: string;
  severity: "error" | "warning";
  target: CheckJumpTarget;
  /** Tooltip of the entry: where a click leads, and the raw field path the readable message replaces. */
  targetLabel: string;
}

export interface CheckGroup {
  category: CheckCategory;
  entries: CheckEntry[];
  label: string;
}

/** One checked document (the campaign or a map) with its entries grouped by kind and counted. */
export interface CheckSection {
  errors: number;
  errorsLabel: string;
  groups: CheckGroup[];
  id: string;
  title: string;
  warnings: number;
  warningsLabel: string;
}

/**
 * The kind of problem an issue is, by its code, path and source (no validation logic: only sorting of reported
 * issues). Whatever a map file's script check reports beyond texts and rewards stays under "script": it is fixed
 * in the script editor, unset slots and unknown ids alike.
 */
export const checkCategoryOf = (issue: Pick<CheckIssue, "code" | "origin" | "path">): CheckCategory => {
  if (CHECK_TRANSLATION_CODES.has(issue.code)) return "translation";
  if (CHECK_PATH_CODES.has(issue.code)) return "path";
  if (issue.origin === "reward" || CHECK_REWARD_CODES.has(issue.code) || CHECK_REWARD_PATH.test(issue.path))
    return "reward";
  if (issue.origin === "script") return "script";
  return CHECK_REFERENCE_CODES.has(issue.code) ? "reference" : "other";
};

const tabTarget = (tab: WorkspaceTabId, mapId: string | null = null): CheckJumpTarget =>
  ({ kind: "tab", mapId, tab });

/** The translation table cell of an issue that names a record text (or one language of it). */
const textTarget = (issue: CheckIssue, texts: readonly CampaignTextEntry[]): CheckJumpTarget | null => {
  if (issue.origin !== "record") return null;
  const text = texts.find(entry => issue.path === entry.issuePath || issue.path.startsWith(`${entry.issuePath}.`));
  if (!text) return null;
  const pathLanguage = issue.path.slice(text.issuePath.length + 1);
  const language = String(issue.params.language ?? (pathLanguage || "en"));
  return { kind: "tab", language, mapId: text.mapId, tab: "translations", textId: text.id };
};

/** Campaign document fields by the tab that edits them (graph issues: the concerned map's exits, start maps). */
const campaignFieldTarget = (
  issue: CheckIssue, campaign: Campaign, maps: readonly CampaignMap[]
): CheckJumpTarget => {
  const [field] = parseIssuePath(issue.path);
  if (field === "speakers") return tabTarget("speakers");
  if (field === "mapNodes") return tabTarget("map-view");
  if (field !== "mapIds" && field !== "edges") return tabTarget("details");
  const mapId = graphIssueMapId(issue.path, issue.params, campaign);
  return tabTarget("maps", maps.find(map => map.id === mapId)?.id ?? null);
};

const isStoryQuest = (map: CampaignMap, index: unknown) => {
  const quest = typeof index === "number" ? map.quests[index] : undefined;
  return quest !== undefined && !quest.hidden && STORY_KINDS.some(kind => STORY_TRIGGER[kind] === quest.trigger.kind);
};

/** Map record fields: the Maps and Story tabs edit a few; the rest (and the map file) open the map editor. */
const scriptTarget = (issue: CheckIssue, map: CampaignMap, names: ScriptPathNames | undefined): CheckJumpTarget => {
  const script = scriptIssueLink(issue.path, names);
  return { kind: "mapEditor", mapId: map.id, ...(script ? { script } : {}) };
};

const mapFieldTarget = (issue: CheckIssue, map: CampaignMap, names?: ScriptPathNames): CheckJumpTarget => {
  const [field, index] = parseIssuePath(issue.path);
  if (issue.origin === "script") return scriptTarget(issue, map, names);
  if (field === "quests" && isStoryQuest(map, index)) return tabTarget("story", map.id);
  if (typeof field === "string" && MAP_SETTINGS_FIELDS.has(field)) return tabTarget("maps", map.id);
  return { kind: "mapEditor", mapId: map.id };
};

/** Where an issue of the campaign document (`map` null) or of one map is fixed. */
export const checkJumpTarget = (
  issue: CheckIssue, map: CampaignMap | null, context: Pick<SectionContext, "campaign" | "maps" | "texts">,
  scriptNames?: ScriptPathNames
): CheckJumpTarget => {
  const documentTexts = context.texts.filter(text => text.mapId === (map?.id ?? null));
  return textTarget(issue, documentTexts) ??
    (map ? mapFieldTarget(issue, map, scriptNames) : campaignFieldTarget(issue, context.campaign, context.maps));
};

const withOrigin = (issues: readonly (CampaignIssue | ScriptIssue)[], origin: CheckOrigin): CheckIssue[] =>
  issues.map(issue => ({ ...issue, origin }));

const resultIssues = (
  result: { errors: readonly (CampaignIssue | ScriptIssue)[]; warnings: readonly (CampaignIssue | ScriptIssue)[] },
  origin: CheckOrigin
) => withOrigin([...result.errors, ...result.warnings], origin);

/** Every reported issue of one checked map: record, reward lines, then the map file's script. */
const mapCheckIssues = (check: CampaignMapCheck): CheckIssue[] => [
  ...resultIssues(check.result, "record"),
  ...withOrigin(check.rewards ?? [], "reward"),
  ...(check.script ? resultIssues(check.script, "script") : [])
];

interface SectionContext {
  campaign: Campaign;
  i18n: I18n | undefined;
  language: string;
  mapNames: ReadonlyMap<string, string>;
  maps: readonly CampaignMap[];
  tabLabels: Readonly<Record<string, string>>;
  texts: readonly CampaignTextEntry[];
}

/** The document an issue list belongs to: the campaign (`map` null) or a map with its script's item names. */
interface SectionDocument {
  id: string;
  map: CampaignMap | null;
  scriptNames?: ScriptPathNames;
}

/** The issue's field in words (CUX-PATHS): script paths by trigger/quest name and slot word, record paths by field. */
const issuePathLabel = (issue: CheckIssue, checked: SectionDocument, context: SectionContext) => {
  if (!issue.path) return "";
  if (issue.origin === "script") return scriptPathLabel(issue.path, checked.scriptNames, context);
  return recordPathLabel(issue.path, checked.map, context);
};

/**
 * The message with the readable field instead of the raw path; record issues also name maps and exits by their
 * display names instead of the record ids (`{mapId}`, `{from}`, `{to}`, `{exit}` placeholders).
 */
const issueMessage = (issue: CheckIssue, checked: SectionDocument, context: SectionContext) => {
  const readable = { ...issue, path: issuePathLabel(issue, checked, context) };
  if (issue.origin !== "record") return formatScriptIssue(readable as ScriptIssue, context.language);
  const params = namedGraphParams(issue.params, context.maps, context.mapNames, context.language);
  return formatCampaignIssue({ ...readable, params } as CampaignIssue, context.language);
};

/** Tab ids are kebab-case, the label table is keyed in camelCase (`map-view` → `mapView`). */
const tabLabelKey = (tab: WorkspaceTabId) => tab.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

const jumpLabel = (target: CheckJumpTarget, context: SectionContext) => {
  if (target.kind === "mapEditor" && target.script) return translateMessage(context.i18n, M.check.openScript);
  if (target.kind === "mapEditor") return translateMessage(context.i18n, M.check.openMapEditor);
  return translateMessage(context.i18n, M.check.openTab, { tab: context.tabLabels[tabLabelKey(target.tab)] ?? "" });
};

/** The entry tooltip: where a click leads, then the raw field path (kept only here). */
const targetLabel = (target: CheckJumpTarget, path: string, context: SectionContext) => {
  const jump = jumpLabel(target, context);
  return path ? translateMessage(context.i18n, M.check.rawPath, { path, target: jump }) : jump;
};

const sectionEntries = (
  issues: readonly CheckIssue[], checked: SectionDocument, context: SectionContext
): CheckEntry[] => issues.flatMap((issue, index) => {
  if (issue.severity === "info") return [];
  const target = checkJumpTarget(issue, checked.map, context, checked.scriptNames);
  return [{
    category: checkCategoryOf(issue), id: `${checked.id}:${index}`, message: issueMessage(issue, checked, context),
    severity: issue.severity, target, targetLabel: targetLabel(target, issue.path, context)
  }];
});

const errorsFirst = (entries: readonly CheckEntry[]) =>
  [...entries.filter(entry => entry.severity === "error"), ...entries.filter(entry => entry.severity === "warning")];

const section = (id: string, title: string, entries: readonly CheckEntry[], i18n: I18n | undefined): CheckSection => {
  const errors = entries.filter(entry => entry.severity === "error").length, warnings = entries.length - errors;
  const groups = CHECK_CATEGORIES.map(category => ({
    category,
    entries: errorsFirst(entries.filter(entry => entry.category === category)),
    label: translateMessage(i18n, M.check.categories[category])
  }));
  return {
    errors,
    errorsLabel: translateMessage(i18n, M.check.errors, { count: errors }),
    groups: groups.filter(group => group.entries.length > 0),
    id,
    title,
    warnings,
    warningsLabel: translateMessage(i18n, M.check.warnings, { count: warnings })
  };
};

const sectionContext = (campaign: Campaign, maps: readonly CampaignMap[], i18n: I18n | undefined) => {
  const language = (i18n?.locale ?? "en").split("-")[0] ?? "en";
  return {
    campaign,
    i18n,
    language,
    mapNames: new Map(maps.map(map => [map.id, displayText(map.name, language, map.id)])),
    maps,
    tabLabels: workspaceTabLabels(i18n),
    texts: collectCampaignTexts(campaign, maps)
  } satisfies SectionContext;
};

/**
 * The Check panel's sections: the campaign first, then every checked map with a problem, each grouped by kind
 * (script, translations, references, rewards, settings) with error and warning counts and a jump target per entry.
 */
export const checkSections = (
  report: CampaignReadyReport, campaign: Campaign, maps: readonly CampaignMap[], i18n?: I18n
): CheckSection[] => {
  const context = sectionContext(campaign, maps, i18n);
  const campaignIssues = [...resultIssues(report.campaign, "record"), ...withOrigin(report.campaignRewards ?? [],
    "reward")];
  const sections = [
    section("campaign", translateMessage(i18n, M.validation.campaign),
      sectionEntries(campaignIssues, { id: "campaign", map: null }, context), i18n),
    ...report.maps.flatMap(check => {
      const map = maps.find(entry => entry.id === check.mapId);
      if (!map) return [];
      return [section(map.id, context.mapNames.get(map.id) ?? map.id,
        sectionEntries(mapCheckIssues(check), { id: map.id, map, scriptNames: check.scriptNames }, context), i18n)];
    })
  ];
  return sections.filter(entry => entry.groups.length > 0);
};

/** The panel header of a report: totals and how many of the campaign's maps the last check covered. */
export const checkSummary = (report: CampaignReadyReport, maps: readonly CampaignMap[], i18n?: I18n) => ({
  coverage: translateMessage(i18n, M.check.coverage, { checked: report.maps.length, total: maps.length }),
  totals: translateMessage(i18n, M.status.checked, reportTotals(report))
});

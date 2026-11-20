import { exitsOf } from "../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { CampaignMapExit } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  formatScriptIssue, type ScriptIssue, type ScriptValidationResult
} from "../../../../../island-of-settlers-shared/src/script/issues";
import type { MapKind } from "../../../../../island-of-settlers-shared/src/script/types/refs";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { WorldData } from "../../../shared/world/world-data";
import { validateWorldScript } from "../../../shared/world/world-script-ready";
import { UNSET_OPERAND_ID } from "./constants";
import { issueSubject, ownerOf } from "./issue-paths";
import { isPathPrefix, type NodePath, parseIssuePath } from "./paths";

/**
 * Live validation of the edited script (design §11.1, §13.2): the shared Ready check plus the map's placed-object
 * fingerprints (`validateWorldScript`), with each issue mapped to its trigger and node path for the rows.
 */

export interface ShownIssue {
  /** Path inside the trigger (or the top-level item) the issue names. */
  path: NodePath;
  severity: ScriptIssue["severity"];
  text: string;
}

export interface ScriptIssueIndex {
  errors: number;
  /** Issues by owner: `trigger:<i>`, `actor:<i>`, `quest:<i>`, `variable:<i>`, `homeReward:<i>`, `other`. */
  byOwner: ReadonlyMap<string, readonly ShownIssue[]>;
  ready: boolean;
  warnings: number;
}

type ScriptWorld = Pick<WorldData, "audioAssets" | "cellsX" | "scenario">;

/** The map kind the Ready check uses: the scenario's kind (a map without a scenario is a home island). */
export const scriptMapKind = (world: Pick<WorldData, "scenario">): MapKind => world.scenario?.kind ?? "home";

/**
 * Runs the Ready check on the edited script against the map. `mapExits` are the declared exits of its campaign map
 * record: when they are known an `endMap` may only name one of them (or the implicit exit); null: not checked.
 */
export const validateEditedScript = (
  world: ScriptWorld, script: MapScript, mapExits: readonly CampaignMapExit[] | null = null
): ScriptValidationResult => validateWorldScript({ ...world, script }, {
  mapKind: scriptMapKind(world), ...(mapExits ? { exitIds: new Set(exitsOf({ exits: [...mapExits] })) } : {})
})!;

/** A new condition's unset operand (a never-existing variable) reads as "must be set", not as an unknown id. */
const asUnsetOperand = (issue: ScriptIssue, slot: string): ScriptIssue => (issue.code === "unknownReference" &&
  issue.params.id === UNSET_OPERAND_ID ? { ...issue, code: "missingSlot", params: { slot } } : issue);

/** The issue's message with a readable subject instead of the raw path. */
export const issueText = (reported: ScriptIssue, path: NodePath, locale: string) => {
  const language = locale.split("-")[0] ?? "en";
  const subject = issueSubject(path, locale);
  const issue = asUnsetOperand(reported, subject);
  const text = formatScriptIssue({ ...issue, path: subject }, language);
  return subject ? text : text.replace(/^:\s*/, "");
};

/** Groups formatted issues by owner (trigger/actor index) with their path below the owner. */
export const indexIssues = (result: ScriptValidationResult, locale: string): ScriptIssueIndex => {
  const byOwner = new Map<string, ShownIssue[]>();
  for (const issue of [...result.errors, ...result.warnings, ...result.infos]) {
    const fullPath = parseIssuePath(issue.path);
    const { depth, owner } = ownerOf(fullPath);
    const path = fullPath.slice(depth);
    const shown = { path, severity: issue.severity, text: issueText(issue, path, locale) };
    byOwner.set(owner, [...byOwner.get(owner) ?? [], shown]);
  }
  return { byOwner, errors: result.errors.length, ready: result.ready, warnings: result.warnings.length };
};

export const triggerIssues = (index: ScriptIssueIndex, triggerIndex: number) =>
  index.byOwner.get(`trigger:${triggerIndex}`) ?? [];

export const actorIssues = (index: ScriptIssueIndex, actorIndex: number) =>
  index.byOwner.get(`actor:${actorIndex}`) ?? [];

/** Issues of one item of a top-level list (`quest`, `variable`, `homeReward`) by its index. */
export const itemIssues = (index: ScriptIssueIndex, kind: "homeReward" | "quest" | "variable", itemIndex: number) =>
  index.byOwner.get(`${kind}:${itemIndex}`) ?? [];

/** Issues of one row: those at or below its node, but not inside a nested step or condition that has its own row. */
export const rowIssues = (issues: readonly ShownIssue[], path: NodePath, childPaths: readonly NodePath[]) =>
  issues.filter(issue => isPathPrefix(path, issue.path) &&
    !childPaths.some(child => isPathPrefix(child, issue.path)));

/** True when an issue names this slot (or something inside its value). */
export const slotHasError = (issues: readonly ShownIssue[], path: NodePath) =>
  issues.some(issue => issue.severity === "error" && isPathPrefix(path, issue.path));

export const countErrors = (issues: readonly ShownIssue[]) => issues.filter(issue => issue.severity === "error")
  .length;
export const countWarnings = (issues: readonly ShownIssue[]) =>
  issues.filter(issue => issue.severity === "warning").length;

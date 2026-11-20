import type { BuildProgram, BuildProgramCatalog, BuildProgramIssue } from "@shared/catalog";

import { titleOf, unlistedBuildings } from "./program-catalog.ts";

/**
 * The readable report of `npm run ai:check`: the validator's issues grouped per program and nation, plus the
 * production and residence buildings a program does not list (information, never an error). Pure.
 */

export interface ProgramReport {
  /** Issues that fail the check (the exit code); unlisted buildings do not count. */
  errors: number;
  lines: string[];
}

const INDENT = "    ";

const goalLabel = (issue: BuildProgramIssue) => `goal "${issue.goal}"`;

const WORDING: Record<BuildProgramIssue["kind"], (issue: BuildProgramIssue) => string> = {
  missingProducer: issue => `no chain produces "${issue.ware}" (needed by: ${(issue.neededBy ?? []).join(", ")})`,
  notPlaceable: issue => `${goalLabel(issue)}: "${issue.building}" cannot be placed by this nation`,
  overlay: issue => `overlay ${issue.path}: ${issue.message}`,
  program: issue => issue.goal ? `${goalLabel(issue)}: ${issue.message}` : issue.message,
  requirement: issue => `${goalLabel(issue)}: requirement ${issue.message}`,
  shape: issue => `${issue.path}: ${issue.message}`,
  stockMargin: issue => `stock target ${issue.ware ?? "default"}: ${issue.message}`,
  stockWare: issue => `stock target "${issue.ware}": no goal produces it`,
  unknownBuilding: issue => `${goalLabel(issue)}: building "${issue.building}" no longer exists (removed or retired)`
};

const section = (title: string, lines: readonly string[]) =>
  lines.length ? [`  ${title}`, ...lines.map(line => `${INDENT}${line}`)] : [];

/** An unknown building is reported once for the program, not once more per nation that cannot place it. */
const withoutRepeats = (issues: readonly BuildProgramIssue[]) => {
  const unknown = new Set(issues.filter(issue => issue.kind === "unknownBuilding").map(issue => issue.goal));
  return issues.filter(issue => issue.kind !== "notPlaceable" || !unknown.has(issue.goal));
};

/** `raw`: the program resolved (an overlay onto its base); unread while the file is malformed or unresolved. */
const unlistedLines = (catalog: BuildProgramCatalog, raw: unknown, issues: readonly BuildProgramIssue[]) => {
  if (issues.some(issue => issue.kind === "shape" || issue.kind === "overlay")) return [];
  return unlistedBuildings(catalog, raw as BuildProgram)
    .map(building => `info   building "${building.key}" (${building.name}) is not in this program`);
};

const programLines = (
  catalog: BuildProgramCatalog, style: string, raw: unknown, issues: readonly BuildProgramIssue[]
) => {
  const errorLine = (issue: BuildProgramIssue) => `error  ${WORDING[issue.kind](issue)}`;
  const unlisted = unlistedLines(catalog, raw, issues);
  const nations = catalog.nations.flatMap(nation => section(titleOf(nation),
    issues.filter(issue => issue.nation === nation).map(errorLine)));
  return [
    `${style} (ai/${style}.json): ${issues.length} errors, ${unlisted.length} unlisted buildings`,
    ...section("Program", issues.filter(issue => issue.nation === undefined).map(errorLine)),
    ...nations,
    ...section("Not in this program (run npm run ai:suggest for draft goals)", unlisted)
  ];
};

export const buildProgramReport = (
  catalog: BuildProgramCatalog, programs: Readonly<Record<string, unknown>>, issues: readonly BuildProgramIssue[]
): ProgramReport => {
  const shown = withoutRepeats(issues);
  const styles = Object.keys(programs);
  const lines = styles.flatMap(style => [
    ...programLines(catalog, style, programs[style], shown.filter(issue => issue.style === style)), ""
  ]);
  const verdict = shown.length ? `FAILED: ${shown.length} errors` : "OK";
  return {
    errors: shown.length,
    lines: [`AI build programs: ${styles.join(", ")} (${catalog.nations.length} nations)`, "", ...lines, verdict]
  };
};

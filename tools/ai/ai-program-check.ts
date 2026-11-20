import { resolveBuildPrograms, validateBuildPrograms } from "@shared/catalog";

import { buildProgramReport } from "./program-report.ts";
import { loadProgramSources } from "./program-sources.ts";

/**
 * npm run ai:check: validates every computer build program (`data/ai/<style>.json`) against the catalog with the
 * catalog's own validator and prints the issues per program and nation. Run after any building, ware, recipe or
 * construction cost change. Exit code 1 on errors; unlisted production buildings are information only.
 */
const { catalog, files, programs, readSidecar } = loadProgramSources();
const issues = validateBuildPrograms(files, readSidecar, programs);
// Overlays (`extends`, EAI5a) are reported against the whole program they resolve to.
const report = buildProgramReport(catalog, resolveBuildPrograms(programs), issues);
console.log(report.lines.join("\n"));
process.exitCode = report.errors ? 1 : 0;

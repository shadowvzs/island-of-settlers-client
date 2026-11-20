import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildProgramCatalog, CORE_DATA_FILES } from "@shared/catalog";

import { CATALOG_DATA_FOLDER, readSidecar } from "../../../island-of-settlers-shared/server/catalog-check.ts";

const PROGRAM_FOLDER = "ai";
/** Where `npm run ai:suggest` writes its drafts; nothing loads this folder. */
export const DRAFT_FOLDER = join(CATALOG_DATA_FOLDER, PROGRAM_FOLDER, "drafts");

const readOptionalSidecar = (path: string): unknown =>
  existsSync(join(CATALOG_DATA_FOLDER, path)) ? readSidecar(path) : undefined;

/** Every `data/ai/<style>.json` on disk keyed by style a-z, so a program not yet registered in code is seen too. */
const readPrograms = (): Record<string, unknown> => Object.fromEntries(
  readdirSync(join(CATALOG_DATA_FOLDER, PROGRAM_FOLDER), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => entry.name.slice(0, -".json".length))
    .sort((first, second) => first.localeCompare(second, "en"))
    .map(style => [style, readSidecar(`${PROGRAM_FOLDER}/${style}.json`)]));

/** The real catalog and build programs as the AI program tools read them (Node only). */
export const loadProgramSources = () => ({
  catalog: buildProgramCatalog(CORE_DATA_FILES, readOptionalSidecar),
  files: CORE_DATA_FILES,
  programs: readPrograms(),
  readSidecar: readOptionalSidecar
});

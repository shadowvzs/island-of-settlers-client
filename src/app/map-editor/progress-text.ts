import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";

const GENERATION_PHASES = {
  "Building biomes and vegetation": M.phase.biome,
  "Building navigation and terrain lighting": M.phase.navigation,
  "Checking usable mineral work areas": M.phase.mineral,
  "Eroding and smoothing terrain": M.phase.erosion,
  "Finalizing editable source metadata": M.phase.sourceMetadata,
  "Placing mineral deposits": M.phase.deposits,
  "Securing home stone, coal and iron": M.phase.homeStone,
  "Shaping island and mountain sources": M.phase.shaping,
  "Tracing and carving connected rivers": M.phase.rivers,
  "Validating reserved building space and harbour approaches": M.phase.reservedSpace
} as const;

const SEED_PROBLEMS = {
  "This map has no exact saved generator recipe. Named baseline restoration remains available.": M.hints.seedNoRecipe,
  "This map uses a different terrain generator version; exact seed regeneration is unavailable.": M.hints.seedVersion,
  "The saved generator recipe belongs to a different map.": M.hints.seedDifferentMap,
  "The saved generator recipe is invalid.": M.hints.seedInvalidRecipe
} as const;

const START_MAP_ERRORS = {
  "The saved map could not be read: browser storage is not available.": M.library.storageReadFailed,
  "The saved map is gone (deleted, or the browser data was cleared).": M.library.storageMissing,
  "The saved map could not be read.": M.library.storageReadError
} as const;

/** A startup map-read error in the active locale; unknown file diagnostics pass through. */
export const getStartMapErrorText = (error: string): EditorText =>
  START_MAP_ERRORS[error as keyof typeof START_MAP_ERRORS] ?? error;

/** A seed-regeneration refusal in the active locale; unknown shared diagnostics pass through. */
export const getSeedProblemText = (problem: string): EditorText =>
  SEED_PROBLEMS[problem as keyof typeof SEED_PROBLEMS] ?? problem;

/** Worker phase names resolved at presentation; unknown phases fall back to a translated working line. */
export const getGenerationPhaseText = (phase: string): EditorText =>
  GENERATION_PHASES[phase as keyof typeof GENERATION_PHASES] ?? M.phase.working;

const EXACT_NAVIGATION_PHASES = {
  "Authored public road graph": M.phase.authoredRoads,
  "Native sea, hull and turning masks": M.phase.seaMasks,
  "Preparing authored navigation": M.phase.authoredNavigation
} as const;

/** Scenario-space inspection stage names (the fixed ones and the work-area prefix). */
export const getSpaceStageText = (stage: string): EditorText => {
  if (stage === "Authored scenario") return M.inspection.stageAuthored;
  if (stage === "Harbour approaches") return M.inspection.stageHarbour;
  const workArea = /^Work area: (.+)$/.exec(stage);
  if (workArea) return editorMessage(M.inspection.stageWorkArea, { name: workArea[1]! });
  return M.phase.working;
};

/** Navigation worker phases: the known fixed steps and their counted variants, without leaking English. */
export const getNavigationPhaseText = (phase: string): EditorText => {
  const exact = EXACT_NAVIGATION_PHASES[phase as keyof typeof EXACT_NAVIGATION_PHASES];
  if (exact) return exact;
  const walking = /^Whole-map walking graph: (\d+) node\/edge batches$/.exec(phase);
  if (walking) return editorMessage(M.phase.walkingGraph, { batches: Number(walking[1]) });
  const road = /^Public road access: building (\S+)$/.exec(phase);
  if (road) return editorMessage(M.phase.publicRoad, { uid: road[1]! });
  const sea = /^Sea clearance: (\d+) cells$/.exec(phase);
  if (sea) return editorMessage(M.phase.seaClearance, { cells: Number(sea[1]) });
  const harbourPair = /^Harbour pair (\S+)\/(\S+)$/.exec(phase);
  if (harbourPair) return editorMessage(M.phase.harbourPair, { first: harbourPair[1]!, second: harbourPair[2]! });
  const harbour = /^Harbour (\S+): berth, turn and swept ocean route$/.exec(phase);
  if (harbour) return editorMessage(M.phase.harbour, { id: harbour[1]! });
  return M.phase.working;
};

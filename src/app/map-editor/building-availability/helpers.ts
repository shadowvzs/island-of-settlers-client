import type { I18n } from "@lingui/core";

import {
  availabilityTier, type BuildingAvailability, MAX_BUILDING_TIER
} from "../../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { BUILDING_MENU } from "../../../render-common/buildings/building-menu";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { displayBuildingName, displayWareName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import {
  type AvailabilityIssue, availabilityChainIssues, availabilityMaterialIssues
} from "../../../shared/world/availability-checks";
import type { MapScenario } from "../../../shared/world/map-scenario";
import { NEVER_BANNED_BUILDINGS } from "../../../shared/world/scenario-availability";
import type { WorldData } from "../../../shared/world/world-data";
import { ineffectiveLevelCaps, withoutCap, withoutCapsAtTier } from "./level-caps";
import { BUILDING_AVAILABILITY_MESSAGES as M } from "./messages";

/** What the section shows of the scenario (a plain copy, published after each edit). */
export interface BuildingAvailabilityState {
  availability: BuildingAvailability;
  /** Map-dependent issues (material sources), computed on refresh so the view never scans the props. */
  materialIssues: AvailabilityIssue[];
  nation: WorkerNation;
}

const NAMES_SHOWN = 3;
export const TIER_OPTIONS = Array.from({ length: MAX_BUILDING_TIER }, (_, index) => index + 1);

/** Building types a map may ban, in build-menu order (never the HQ, Harbour or Storehouse). */
export const BANNABLE_TYPES: readonly number[] = BUILDING_MENU.flatMap(group => group.buildings
  .map(building => building.id)).filter(id => !NEVER_BANNED_BUILDINGS.has(id));

export const toBuildingAvailabilityState = (
  scenario: MapScenario | undefined, world: Pick<WorldData, "colonyStoneDeposits" | "props"> | undefined
): BuildingAvailabilityState => {
  const availability = structuredClone(scenario?.availability ?? {});
  const deposits = [...scenario?.marbleDeposits ?? [], ...world?.colonyStoneDeposits ?? []];
  return {
    availability,
    materialIssues: availabilityMaterialIssues({ deposits, propTypes: world?.props.types ?? [], rules: availability }),
    nation: scenario?.nation ?? "roman"
  };
};

/** Availability without empty parts; undefined when nothing narrows (files without it stay unchanged). */
const normalized = (rules: BuildingAvailability): BuildingAvailability | undefined => {
  const next: BuildingAvailability = {};
  if (rules.banned?.length) next.banned = rules.banned;
  if (rules.levelCaps?.length) next.levelCaps = rules.levelCaps;
  if (rules.tier !== undefined && rules.tier < MAX_BUILDING_TIER) next.tier = rules.tier;
  return Object.keys(next).length ? next : undefined;
};

export const applyAvailability = (scenario: MapScenario, rules: BuildingAvailability) => {
  const next = normalized(rules);
  if (next) scenario.availability = next;
  else delete scenario.availability;
};

/** A new tier drops the per-building caps it makes pointless (at or above it). */
export const withTier = (rules: BuildingAvailability, tier: number): BuildingAvailability =>
  withoutCapsAtTier({ ...rules, tier });

export const withBanToggled = (rules: BuildingAvailability, typeId: number): BuildingAvailability => {
  const banned = new Set(rules.banned ?? []);
  if (banned.has(typeId)) banned.delete(typeId);
  else banned.add(typeId);
  const next = { ...rules, banned: [...banned].sort((first, second) => first - second) };
  return banned.has(typeId) ? withoutCap(next, typeId) : next;
};

const nameList = (ids: readonly number[], nation: WorkerNation, i18n?: I18n) => {
  const names = ids.slice(0, NAMES_SHOWN).map(id => displayBuildingName(id, nation, i18n)).join(", ");
  if (ids.length <= NAMES_SHOWN) return names;
  return translateMessage(i18n, M.more, { count: ids.length - NAMES_SHOWN, names });
};

/** One validation line per issue, in the editor's warning list shape. */
const availabilityIssueLines = (
  issues: readonly AvailabilityIssue[], nation: WorkerNation, i18n?: I18n
) => issues.map((issue, index) => {
  const key = `${issue.kind}:${index}`;
  if (issue.kind === "noMaterialSource")
    return { key, severity: issue.severity, text: translateMessage(i18n, M.noSource, issue) };
  const message = issue.severity === "error" ? M.chainBuild : M.chainWork;
  return { key, severity: issue.severity, text: translateMessage(i18n, message, {
    banned: nameList(issue.banned, nation, i18n), buildings: nameList(issue.neededBy, nation, i18n),
    ware: displayWareName(issue.ware, i18n)
  }) };
});

/** Chain issues (catalog only) after the map's material issues. */
const availabilityIssues = (state: BuildingAvailabilityState) => [
  ...availabilityChainIssues({ nation: state.nation, rules: state.availability }), ...state.materialIssues
];

/** The editor's own line for stored caps that change nothing (hand-edited or older files). */
const levelCapIssueLines = (state: BuildingAvailabilityState, i18n?: I18n) => {
  const types = ineffectiveLevelCaps(state.availability);
  if (!types.length) return [];
  const buildings = nameList(types, state.nation, i18n);
  return [{ key: "levelCaps", severity: "warning" as const,
    text: translateMessage(i18n, M.capIneffective, { buildings }) }];
};

/** Every validation line: the availability issues, then the ineffective level caps. */
export const availabilityValidationLines = (state: BuildingAvailabilityState, i18n?: I18n) => [
  ...availabilityIssueLines(availabilityIssues(state), state.nation, i18n), ...levelCapIssueLines(state, i18n)
];

export const currentTier = (state: BuildingAvailabilityState) => availabilityTier(state.availability);

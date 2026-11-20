import type { I18n } from "@lingui/core";

import { displayNationName } from "../../../../shared/i18n/domain";
import { translateMessage } from "../../../../shared/i18n/translate";
import {
  FACTION_AI_BONUS_PERCENT_RANGE, FACTION_AI_CAPS, FACTION_AI_LEVELS, FACTION_AI_LIMIT_RANGES,
  FACTION_AI_MAINTAIN_POPULATION, FACTION_AI_MODES, FACTION_AI_STYLES
} from "../../../../shared/world/constants";
import type { FactionAiMode, ScenarioFactionAi } from "../../../../shared/world/scenario-faction-ai";
import { type FactionAiIssue, formatFactionAiIssue } from "../../../../shared/world/scenario-faction-ai-issues";
import { MAX_FACTION } from "../../../../shared/world/scenario-players";
import {
  DEFAULT_FACTION_AI_STYLE, FACTION_AI_BONUS_KEYS, FACTION_AI_ICONS, FACTION_AI_LIMIT_KEYS, type FactionAiLimitKey,
  ISLAND_LEVEL_VALUE
} from "./constants";
import { depotStartEntries, type FactionAiState } from "./helpers";
import { FACTION_AI_MESSAGES as M } from "./messages";

/** A pressed-group icon button: the label is its tooltip and accessible name. */
export interface FactionAiChoiceView<T extends string> {
  disabled: boolean;
  icon: string;
  id: T;
  label: string;
  pressed: boolean;
}

/** A small numeric input; empty text means "absent" and the placeholder shows what applies then. */
export interface FactionAiNumberView<T extends string> {
  hint: string;
  id: T;
  label: string;
  max: number;
  min: number;
  placeholder: string;
  text: string;
}

/** One line of the section's validation list. */
export interface ValidationLineView {
  key: string;
  severity: "error" | "warning";
  text: string;
}

type Translate = (descriptor: Parameters<typeof translateMessage>[1], values?: Record<string, unknown>) => string;

const modeChoices = (t: Translate, mode: FactionAiMode) => FACTION_AI_MODES.map(id => ({
  disabled: false, icon: FACTION_AI_ICONS[id], id, label: t(M.modes[id]), pressed: id === mode
}));

const styleChoices = (t: Translate, entry: ScenarioFactionAi | undefined) => {
  const develop = entry?.mode === "develop", current = entry?.style ?? DEFAULT_FACTION_AI_STYLE;
  return FACTION_AI_STYLES.map(id => {
    const label = t(M.styles[id]);
    return { disabled: !develop, icon: FACTION_AI_ICONS[id], id, label: develop ? label :
      t(M.styles.disabled, { style: label }), pressed: develop && id === current };
  });
};

const levelView = (t: Translate, entry: ScenarioFactionAi | undefined) => ({
  disabled: !entry, label: t(M.level), value: entry?.level ?? ISLAND_LEVEL_VALUE,
  options: [
    { label: t(M.levels.island), value: ISLAND_LEVEL_VALUE },
    ...FACTION_AI_LEVELS.map(level => ({ label: t(M.levels[level]), value: level }))
  ]
});

const bonusFields = (t: Translate, entry: ScenarioFactionAi) => {
  const [min, max] = FACTION_AI_BONUS_PERCENT_RANGE, hint = t(M.bonusHint, { max, min });
  return FACTION_AI_BONUS_KEYS.map(id => ({ hint, id, label: t(M.bonus[id]), max, min, placeholder: String(min),
    text: String(entry.bonus?.[id] ?? "") }));
};

/** What applies to an empty limit: develop has the owner's caps; maintain keeps 20 civilians and what was authored. */
const limitPlaceholder = (t: Translate, mode: FactionAiMode, key: FactionAiLimitKey) => {
  if (mode === "develop") return String(FACTION_AI_CAPS[key]);
  if (key === "population") return String(FACTION_AI_MAINTAIN_POPULATION);
  return t(M.limitAuto);
};

const limitFields = (t: Translate, entry: ScenarioFactionAi) => FACTION_AI_LIMIT_KEYS.map(id => {
  const [min, max] = FACTION_AI_LIMIT_RANGES[id];
  return { hint: t(M.limitHint, { max, min }), id, label: t(M.limits[id]), max, min,
    placeholder: limitPlaceholder(t, entry.mode, id), text: String(entry.limits?.[id] ?? "") };
});

const detailsView = (t: Translate, entry: ScenarioFactionAi | undefined, faction: number) => {
  if (!entry) return null;
  return {
    bonus: bonusFields(t, entry), bonusTitle: t(M.bonusTitle), depotEmpty: t(M.depotEmpty),
    entries: depotStartEntries(entry), label: t(M.details, { faction }), limits: limitFields(t, entry),
    limitsTitle: t(M.limitsTitle)
  };
};

/** The badge text of the faction's `handicap` warning (its largest bonus), or empty without one. */
const handicapBadge = (t: Translate, issues: readonly FactionAiIssue[], faction: number) => {
  const handicap = issues.find(issue => issue.code === "handicap" && issue.params.faction === faction);
  return handicap ? t(M.handicap, { percent: handicap.params.percent }) : "";
};

const chipLabel = (i18n: I18n | undefined, t: Translate, state: FactionAiState, faction: number) => {
  const nation = state.slotNations[faction];
  if (!nation) return t(M.chip, { faction });
  return t(M.chipNation, { faction, nation: displayNationName(nation, i18n) });
};

const rowView = (i18n: I18n | undefined, t: Translate, state: FactionAiState, faction: number) => {
  const entry = state.entries.find(candidate => candidate.faction === faction);
  return {
    chip: String(faction), chipLabel: chipLabel(i18n, t, state, faction), details: detailsView(t, entry, faction),
    faction, handicap: handicapBadge(t, state.issues, faction), level: levelView(t, entry),
    modes: modeChoices(t, entry?.mode ?? "none"), nation: state.slotNations[faction] ?? state.nation,
    styles: styleChoices(t, entry)
  };
};

export type FactionAiRowView = ReturnType<typeof rowView>;

/** Everything the Computer factions rows render, translated for the active locale; hidden on a home map. */
export const factionAiView = (i18n: I18n | undefined, state: FactionAiState) => {
  const t: Translate = (descriptor, values) => translateMessage(i18n, descriptor, values as never);
  const pending = state.entries.length > 0;
  return {
    addDisabled: state.factions.length >= MAX_FACTION, addLabel: t(M.add),
    pendingHint: pending ? t(M.pendingHint) : "", pendingNote: pending ? t(M.pendingNote) : "",
    rows: state.factions.map(faction => rowView(i18n, t, state, faction)), shown: state.kind !== "home",
    title: t(M.title), titleHint: t(M.titleHint)
  };
};

export type FactionAiView = ReturnType<typeof factionAiView>;

/** The section's validation list: the map rules' warnings, then the faction AI issues (errors first). */
export const validationLines = (
  warnings: readonly string[], issues: readonly FactionAiIssue[]
): ValidationLineView[] => [
  ...warnings.map(text => ({ key: `rules:${text}`, severity: "warning" as const, text })),
  ...issues.map(issue => ({ key: `ai:${issue.code}:${issue.path}`, severity: issue.severity,
    text: formatFactionAiIssue(issue) }))
];

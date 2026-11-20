import type { I18n } from "@lingui/core";

import type { BuildingAvailability } from
  "../../../../../island-of-settlers-shared/src/game-settings/building-availability";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { displayBuildingName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { joinClassNames } from "../../components/helpers";
import { getNationBuildingIconSource } from "../../settlement-ui/building-icons";
import {
  availabilityValidationLines, BANNABLE_TYPES, type BuildingAvailabilityState, currentTier, TIER_OPTIONS
} from "./helpers";
import { canCapLevel, levelCapOf, nextLevelCap } from "./level-caps";
import { BUILDING_AVAILABILITY_MESSAGES as M } from "./messages";

/** What a click on a building icon edits: its ban, or its highest level. */
export type BuildingClickMode = "ban" | "cap";

export interface TierButtonView {
  label: string;
  pressed: boolean;
  text: string;
  tier: number;
}

export interface ModeButtonView {
  label: string;
  mode: BuildingClickMode;
  pressed: boolean;
  text: string;
}

export interface BanButtonView {
  /** "≤N" badge of a capped, allowed building; null when uncapped. */
  capText: string | null;
  className: string;
  icon: string | undefined;
  id: number;
  label: string;
  pressed: boolean;
}

const MODE_MESSAGES = [
  { mode: "ban", text: M.banned, title: M.banMode },
  { mode: "cap", text: M.levelCap, title: M.capMode }
] as const;

const banLabel = (i18n: I18n, building: string, banned: boolean) =>
  translateMessage(i18n, banned ? M.allow : M.ban, { building });

const capLabel = (i18n: I18n, rules: BuildingAvailability, id: number, building: string) => {
  if (!canCapLevel(rules, id)) return translateMessage(i18n, M.capDisabled, { building });
  const level = levelCapOf(rules, id);
  if (level === undefined) return translateMessage(i18n, M.capNone, { building, next: nextLevelCap(rules, id) });
  return translateMessage(i18n, M.capSet, { building, level });
};

interface BuildingButtonSource {
  i18n: I18n;
  mode: BuildingClickMode;
  nation: WorkerNation;
  rules: BuildingAvailability;
}

const buildingButton = ({ i18n, mode, nation, rules }: BuildingButtonSource, id: number): BanButtonView => {
  const building = displayBuildingName(id, nation, i18n), banned = !!rules.banned?.includes(id);
  const cap = banned ? undefined : levelCapOf(rules, id);
  const uncappable = mode === "cap" && !canCapLevel(rules, id);
  return {
    capText: cap === undefined ? null : translateMessage(i18n, M.capBadge, { level: cap }),
    className: joinClassNames("building-availability__ban", uncappable && "building-availability__ban--idle"),
    icon: getNationBuildingIconSource(id, nation),
    id,
    label: mode === "ban" ? banLabel(i18n, building, banned) : capLabel(i18n, rules, id, building),
    pressed: banned
  };
};

/** The section's prepared rows: tier buttons, click modes, building toggles and validation lines. */
export const buildingAvailabilityView = (i18n: I18n, state: BuildingAvailabilityState, mode: BuildingClickMode) => {
  const tier = currentTier(state), source = { i18n, mode, nation: state.nation, rules: state.availability };
  const tiers = TIER_OPTIONS.map((option): TierButtonView => ({
    label: translateMessage(i18n, M.tierOption, { tier: option }), pressed: option === tier,
    text: String(option), tier: option
  }));
  const modes = MODE_MESSAGES.map((entry): ModeButtonView => ({
    label: translateMessage(i18n, entry.title), mode: entry.mode, pressed: entry.mode === mode,
    text: translateMessage(i18n, entry.text)
  }));
  return {
    bans: BANNABLE_TYPES.map(id => buildingButton(source, id)),
    info: translateMessage(i18n, M.info),
    modes,
    tierTitle: translateMessage(i18n, M.tier),
    tiers,
    title: translateMessage(i18n, M.title),
    validation: availabilityValidationLines(state, i18n)
  };
};

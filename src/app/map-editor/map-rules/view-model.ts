import type { I18n, MessageDescriptor } from "@lingui/core";

import { MAX_PLAYER_LEVEL } from "../../../../../island-of-settlers-shared/src/catalog/balance/levels";
import { MIN_PLAYER_LEVEL } from "../../../../../island-of-settlers-shared/src/game-settings/constants";
import {
  type GameSettings, hasHomeIsland, type SimFeatureKey
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { settingAvailability } from "../../../../../island-of-settlers-shared/src/game-settings/setting-availability";
import { rewardScopeOf } from "../../../shared/campaign/game-mode/reward-scope";
import { translateMessage } from "../../../shared/i18n/translate";
import { hasAuthoredStock } from "../../../shared/world/scenario-start-stock";
import {
  FOG_DEPENDENCY_ID, MAP_RULE_FEATURES, MAP_RULE_ICONS, type MapRuleIcon, REWARDED_MAP_KINDS
} from "./constants";
import type { EditorSettingsStatus } from "./editor-game-settings";
import { editorModeView } from "./editor-mode";
import { allowsCatchUpSkip, allowsFixedLevel, type MapRulesState } from "./helpers";
import { MAP_RULES_MESSAGES as M } from "./messages";

/** Why the game settings take a rule out of the map's hands (the toggle is disabled, the map's value is kept). */
export type GameRuleBlock = "gameOff" | "needsHome" | "noFog";

/** One icon toggle: pressed = switched off on this map; disabled ones say why in the tooltip. */
export interface MapRuleToggleView {
  disabled: boolean;
  /** Set when the game settings, not the map, switch the rule off. */
  gameBlock?: GameRuleBlock;
  icon: string;
  id: string;
  label: string;
  /** The rule's plain name (the game-settings badge lists it). */
  name: string;
  pressed: boolean;
}

interface ToggleInput {
  disabledReason?: MessageDescriptor;
  gameOff?: MessageDescriptor | false;
  icon: MapRuleIcon;
  name?: MessageDescriptor;
  off: boolean;
  offLabel: MessageDescriptor;
  onLabel: MessageDescriptor;
}

const toggleView = (i18n: I18n | undefined, id: string, input: ToggleInput): MapRuleToggleView => {
  const { disabledReason, gameOff, icon, name, off, offLabel, onLabel } = input;
  const blocked = gameOff || disabledReason;
  const label = translateMessage(i18n, blocked || (off ? offLabel : onLabel));
  return {
    disabled: Boolean(blocked), icon: MAP_RULE_ICONS[icon], id, label, name: name ? translateMessage(i18n, name) : "",
    pressed: off || Boolean(gameOff), ...(gameOff && { gameBlock: "gameOff" as const })
  };
};

/** The game-settings reason a feature cannot run on any map (dependency rules D4/D5, then the stored switch). */
export const featureGameBlock = (settings: GameSettings, key: SimFeatureKey): GameRuleBlock | undefined => {
  const availability = settingAvailability(settings, key);
  if (!availability.enabled) return availability.reason === FOG_DEPENDENCY_ID ? "noFog" : "needsHome";
  return (settings.features[key] ?? true) ? undefined : "gameOff";
};

const featureToggle = (
  i18n: I18n | undefined, state: MapRulesState, settings: GameSettings, key: SimFeatureKey
): MapRuleToggleView => {
  const feature = translateMessage(i18n, M.features[key]);
  const off = state.rules.features?.[key] === "off";
  const gameBlock = featureGameBlock(settings, key);
  const stateMessage = gameBlock ? M.featureState[gameBlock] : M.featureState[off ? "off" : "inherit"];
  return {
    disabled: Boolean(gameBlock), icon: MAP_RULE_ICONS[key], id: key,
    label: translateMessage(i18n, stateMessage, { feature }), name: feature, pressed: off || Boolean(gameBlock),
    ...(gameBlock && { gameBlock })
  };
};

const catchUpReason = (kind: MapRulesState["kind"]) => {
  if (kind === "home") return M.forbidden.catchUpHome;
  if (kind === "campaign") return M.forbidden.catchUpCampaign;
  return undefined;
};

const progressionToggles = (i18n: I18n | undefined, state: MapRulesState, { progression }: GameSettings) => [
  toggleView(i18n, "talents", { gameOff: !progression.talents && M.gameOff.talents, icon: "talents",
    name: M.names.talents, off: state.rules.talents === "none", offLabel: M.talents.off, onLabel: M.talents.inherit }),
  toggleView(i18n, "experience", { gameOff: !progression.experience && M.gameOff.experience, icon: "experience",
    name: M.names.experience, off: state.rules.experience === "none", offLabel: M.experience.off,
    onLabel: M.experience.inherit }),
  toggleView(i18n, "catchUp", { disabledReason: allowsCatchUpSkip(state.kind) ? undefined : catchUpReason(state.kind),
    icon: "catchUp", off: state.rules.offlineCatchUp === "skip", offLabel: M.catchUp.off, onLabel: M.catchUp.inherit })
];

/**
 * The badges beside "inherit" (plan §13.2): which rules the game settings switch off whatever the map says. One
 * badge per reason, so the row stays compact.
 */
export const gameRuleBadges = (i18n: I18n | undefined, toggles: readonly MapRuleToggleView[]): string[] => {
  const badges: string[] = [];
  const names = toggles.filter(toggle => toggle.gameBlock === "gameOff").map(toggle => toggle.name);
  if (names.length) badges.push(translateMessage(i18n, M.gameBadges.gameOff, { names: names.join(", ") }));
  if (toggles.some(toggle => toggle.gameBlock === "needsHome"))
    badges.push(translateMessage(i18n, M.gameBadges.needsHome));
  if (toggles.some(toggle => toggle.gameBlock === "noFog")) badges.push(translateMessage(i18n, M.gameBadges.noFog));
  return badges;
};

const levelView = (i18n: I18n | undefined, state: MapRulesState) => {
  const allowed = allowsFixedLevel(state.kind);
  let hint = translateMessage(i18n, M.levelHint, { max: MAX_PLAYER_LEVEL, min: MIN_PLAYER_LEVEL });
  if (!allowed) hint = translateMessage(i18n, M.forbidden.fixedLevel);
  return {
    disabled: !allowed, hint, label: translateMessage(i18n, M.level), max: MAX_PLAYER_LEVEL, min: MIN_PLAYER_LEVEL,
    text: state.rules.level ? String(state.rules.level.level) : ""
  };
};

/**
 * Map rewards (coins, claim and expiry times) sail to the home island: shown only when the game pays rewards home
 * (owner Q2, 2026-11-12; rev H10). Hidden fields keep their stored values.
 */
export const mapRewardsShown = (kind: string, settings: GameSettings) =>
  kind !== "home" && rewardScopeOf(settings) === "all";

/** Ready warnings of what the current game mode needs from this map (owner Q2, 2026-11-12). */
export const mapRulesWarnings = (state: MapRulesState, settings: GameSettings): MessageDescriptor[] => {
  const warnings: MessageDescriptor[] = [];
  if (mapRewardsShown(state.kind, settings) && REWARDED_MAP_KINDS.includes(state.kind) && state.rewardCoins <= 0)
    warnings.push(M.warnings.noRewardCoins);
  const noPeople = state.settlers <= 0 && !state.startTroops.length;
  const storyStart = state.kind === "campaign" && !hasHomeIsland(settings);
  if (storyStart && !state.startSetupOff && noPeople) warnings.push(M.warnings.noStoryStart);
  return warnings;
};

const startSetupView = (i18n: I18n | undefined, state: MapRulesState, settings: GameSettings) => {
  const isCampaign = state.kind === "campaign";
  // With a home island an expedition brings its cargo: a campaign map's own start setup is not used then.
  const unusedNote = isCampaign && hasHomeIsland(settings);
  return {
    editLabel: translateMessage(i18n, M.editStart),
    expeditionNote: unusedNote ? translateMessage(i18n, M.startSetup.expedition) : "",
    nationDefaultBadge: hasAuthoredStock(state.stock) ? "" : translateMessage(i18n, M.nationDefaultBadge),
    nationDefaultLabel: translateMessage(i18n, M.nationDefault),
    pickerShown: !state.startSetupOff,
    title: translateMessage(i18n, M.startTitle),
    toggle: isCampaign ? toggleView(i18n, "startSetup", { icon: "startSetup", off: state.startSetupOff,
      offLabel: M.startSetup.off, onLabel: M.startSetup.inherit }) : null
  };
};

/** Everything the section renders, translated for the active locale. */
export const mapRulesView = (
  i18n: I18n | undefined, state: MapRulesState, settings: GameSettings, status: EditorSettingsStatus = "pending"
) => {
  const features = MAP_RULE_FEATURES.map(key => featureToggle(i18n, state, settings, key));
  const progression = progressionToggles(i18n, state, settings);
  return {
    features,
    gameBadges: gameRuleBadges(i18n, [...features, ...progression]),
    level: levelView(i18n, state),
    mode: editorModeView(i18n, settings, status),
    progression,
    rulesTitle: translateMessage(i18n, M.rulesTitle),
    start: startSetupView(i18n, state, settings),
    title: translateMessage(i18n, M.title),
    warnings: mapRulesWarnings(state, settings).map(warning => translateMessage(i18n, warning))
  };
};

export type MapRulesView = ReturnType<typeof mapRulesView>;

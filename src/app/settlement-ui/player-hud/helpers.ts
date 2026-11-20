import type { I18n } from "@lingui/core";

import {
  DEFAULT_PLAYER_AVATAR_GENDER,
  isPlayerAvatarGender
} from "../../../render-common/workers/player-avatar";
import { isWorkerNation } from "../../../render-common/workers/worker-appearance";
import { POPULATION_GROWTH_SECONDS } from "../../../shared/balance/population";
import { translateMessage } from "../../../shared/i18n/translate";
import { claimableQuestCount } from "../../../shared/progression/daily-quests";
import { FULL_PROGRESSION } from "../../../shared/progression/progression-rules";
import { spentTalentPoints, talentModifiers, talentPointsForLevel } from "../../../shared/progression/talents";
import { settlerGrowthSeconds } from "../../../shared/settlement/settlement-talents";
import { joinClassNames } from "../../components/helpers";
import { isShallowEqual } from "../../components/ui-store";
import { formatPopulation, formatWholeNumber } from "../helpers";
import { HUD_MESSAGES } from "../hud/messages";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementPlayerSummary, SettlementUiSnapshot } from "../types";

const portraits = import.meta.glob<string>("../../../../assets/ui-icons/portraits/*.webp", {
  eager: true, import: "default", query: "?url"
});
/**
 * Must match `tools/bench/player-portraits.ts`: breathe, look around, wave and talk at 12 fps, in a
 * sprite sheet of 10 columns x 12 rows (192 px frames, 2x the portrait for high-DPI screens).
 */
export const PORTRAIT_FRAMES = 120;
export const PORTRAIT_FPS = 12;
export const PORTRAIT_COLUMNS = 10;
export const PORTRAIT_ROWS = PORTRAIT_FRAMES / PORTRAIT_COLUMNS;

/** Sheet cell of a frame: frames run left to right, then row by row; the loop wraps. */
export const portraitFrameCell = (frame: number) => {
  const index = frame % PORTRAIT_FRAMES;
  return { column: index % PORTRAIT_COLUMNS, row: Math.floor(index / PORTRAIT_COLUMNS) };
};

/** Portrait diameter in CSS pixels; phones (up to 480 px wide) use the compact one. */
export const PORTRAIT_SIZE = 92;
const COMPACT_PORTRAIT_SIZE = 72;

/**
 * Snaps a size to whole device pixels. The sheet steps by whole portrait sizes per frame; on a
 * fractional pixel ratio an unsnapped size lands between pixels and the figure jitters by 1 px.
 */
export const snapToDevicePixels = (cssPixels: number, pixelRatio: number) =>
  Math.round(cssPixels * pixelRatio) / pixelRatio;

const portraitAsset = (name: string) =>
  portraits[`../../../../assets/ui-icons/portraits/${name}.webp`];

/** Each published nation has its own animated sheet for both player avatar genders. */
export const portraitSheetName = (nation: string, gender: unknown) => {
  const validNation = isWorkerNation(nation) ? nation : "roman";
  const validGender = isPlayerAvatarGender(gender) ? gender : DEFAULT_PLAYER_AVATAR_GENDER[validNation];
  return `${validNation}-${validGender}`;
};

const portraitSheet = (nation: string, gender: unknown) => {
  const validNation = isWorkerNation(nation) ? nation : "roman";
  const name = portraitSheetName(validNation, gender);
  return portraitAsset(name) ??
    portraitAsset(`${validNation}-${DEFAULT_PLAYER_AVATAR_GENDER[validNation]}`) ??
    portraitAsset("roman-male")!;
};

/** The nation's own buildings, trees and sky behind the portrait. */
const portraitBackdrop = (nation: string) =>
  portraitAsset(`${nation}-backdrop`) ?? portraitAsset("roman-backdrop")!;


const getExperienceText = (
  { current, experience, needed }: SettlementPlayerSummary, i18n?: I18n
) => {
  if (!needed) return translateMessage(i18n, M.common.maxLevelXp, { amount: formatWholeNumber(experience) });
  return translateMessage(i18n, M.hud.player.experience, {
    current: formatWholeNumber(current), needed: formatWholeNumber(needed)
  });
};

const getQuestButton = (player: SettlementPlayerSummary, i18n?: I18n) => {
  const ready = claimableQuestCount(player.quests, player.stock) + Number(player.tutorial?.ready ?? false);
  const label = ready
    ? translateMessage(i18n, M.hud.player.questsReady, { count: ready })
    : translateMessage(i18n, M.hud.player.quests);
  const questNew = (player.tutorial?.hasNew ?? false) || (player.questNew ?? false);
  return {
    questBadge: String(ready),
    questClassName: joinClassNames("player-hud__quests", questNew && "is-new", ready > 0 && "is-ready"),
    questLabel: label,
    questReady: ready > 0
  };
};

const getInbox = (player: SettlementPlayerSummary, i18n?: I18n) => {
  const unread = player.messages?.filter(message => !message.read).length ?? 0;
  return {
    inboxBadge: String(unread),
    inboxLabel: unread
      ? translateMessage(i18n, HUD_MESSAGES.player.inboxUnread, { count: unread })
      : translateMessage(i18n, HUD_MESSAGES.player.inbox),
    inboxUnread: unread > 0
  };
};

/** Talent points the player has not placed yet (TALENT-01): a badge on the talents button. */
const getTalentButton = (player: SettlementPlayerSummary, i18n?: I18n) => {
  const free = Math.max(0, talentPointsForLevel(player.level) - spentTalentPoints(player.talents));
  const label = free === 0
    ? translateMessage(i18n, M.hud.player.talents)
    : translateMessage(i18n, free === 1 ? M.hud.player.talentPoint : M.hud.player.talentPoints, { count: free });
  return { talentBadge: String(free), talentLabel: label, talentReady: free > 0 };
};

/** The experience tooltip: level and total experience, with the Monument bonus once it applies. */
const experienceTotalText = (player: SettlementPlayerSummary, i18n?: I18n) => translateMessage(i18n,
  player.monumentBonus ? M.hud.player.experienceTotalMonument : M.hud.player.experienceTotal,
  { experience: formatWholeNumber(player.experience), level: player.level });

/** The level in words, the tooltip of a level star without an experience bar; a map-fixed level says so. */
const levelNoteText = ({ level }: SettlementPlayerSummary, levelLocked: boolean, i18n?: I18n) =>
  translateMessage(i18n, levelLocked ? M.hud.player.levelLocked : M.common.buildingLevel, { level });

/**
 * What the island's rules show of the progression (plan §9.4, owner Q10): the level badge (with a lock when a map
 * fixes it), the experience bar and the talent button. Without an experience bar the star stands alone (compact)
 * and its tooltip names the level.
 */
const getProgression = (player: SettlementPlayerSummary, i18n?: I18n) => {
  const { experienceShown, levelLocked, levelShown, talentsShown } = player.progression ?? FULL_PROGRESSION;
  return {
    experienceShown,
    experienceTotal: experienceShown
      ? experienceTotalText(player, i18n) : levelNoteText(player, levelLocked, i18n),
    levelClassName: joinClassNames("player-hud__experience", !experienceShown && "player-hud__experience--compact"),
    levelLocked,
    levelShown,
    talentsShown
  };
};

/** The island's people against its limit; hidden until the island reports them. */
/** The base growth interval as the rule runs it with the player's settler growth talent. */
const growthText = (snapshot: SettlementUiSnapshot, i18n?: I18n) => {
  const bonus = talentModifiers(snapshot.player?.talents).settlerGrowthSpeed;
  const seconds = Math.round(settlerGrowthSeconds(POPULATION_GROWTH_SECONDS, bonus));
  return bonus > 0
    ? translateMessage(i18n, M.hud.player.growthBonus, { percent: Math.round(bonus * 100), seconds })
    : translateMessage(i18n, M.hud.player.growth, { seconds });
};

const getPopulation = (snapshot: SettlementUiSnapshot, i18n?: I18n) => {
  const { population, populationLimit } = snapshot;
  if (population === undefined) return { populationLabel: "", populationText: "" };
  const count = formatWholeNumber(population);
  let label = translateMessage(i18n, M.hud.player.population, { population: count });
  if (populationLimit !== undefined)
    label = translateMessage(i18n, M.hud.player.populationGrowth, {
      growth: growthText(snapshot, i18n), limit: formatWholeNumber(populationLimit), population: count
    });
  return { populationLabel: label, populationText: formatPopulation(population, populationLimit) };
};

/** Everything the player corner shows, as flat values; null hides the corner. */
export const selectPlayerHud = (snapshot: SettlementUiSnapshot, i18n?: I18n) => {
  const { player } = snapshot;
  if (!player) return null;
  return {
    ...getInbox(player, i18n),
    ...getQuestButton(player, i18n),
    ...getTalentButton(player, i18n),
    ...getPopulation(snapshot, i18n),
    ...getProgression(player, i18n),
    experienceFill: `${Math.round(player.fraction * 100)}%`,
    experienceText: getExperienceText(player, i18n),
    gems: formatWholeNumber(player.gems),
    level: String(player.level),
    nation: player.nation
  };
};

export type PlayerHudModel = NonNullable<ReturnType<typeof selectPlayerHud>>;

/** The corner re-renders only when a shown value changes (the snapshot is new every tick). */
export const isSamePlayerHud = (left: PlayerHudModel | null, right: PlayerHudModel | null) => {
  if (!left || !right) return left === right;
  return isShallowEqual(left, right);
};

/** The experience bar doubles as the portrait toggle. */
export const getPortraitToggle = (portraitHidden: boolean, experienceTotal: string, i18n?: I18n) => ({
  label: translateMessage(
    i18n,
    portraitHidden ? HUD_MESSAGES.player.portrait.show : HUD_MESSAGES.player.portrait.hide
  ),
  title: translateMessage(
    i18n,
    portraitHidden ? HUD_MESSAGES.player.portrait.showTitle : HUD_MESSAGES.player.portrait.hideTitle,
    { experience: experienceTotal }
  )
});

export const getPlayerHudClassName = (portraitHidden: boolean, hasExplorationEntry = false) =>
  joinClassNames(
    "player-hud",
    portraitHidden && "is-portrait-hidden",
    hasExplorationEntry && "has-exploration-entry"
  );

/** Portrait diameter snapped to whole device pixels; phones (up to 480 px wide) use the compact one. */
export const getPortraitSize = (compact: boolean, pixelRatio: number) =>
  `${snapToDevicePixels(compact ? COMPACT_PORTRAIT_SIZE : PORTRAIT_SIZE, pixelRatio)}px`;

/** Sheet geometry, the snapped size and the nation×gender sprite sheet over its backdrop. */
export const getPortraitStyle = (nation: string, gender: unknown, size: string) => ({
  "--portrait-columns": String(PORTRAIT_COLUMNS),
  "--portrait-rows": String(PORTRAIT_ROWS),
  "--portrait-size": size,
  backgroundImage: `url("${portraitSheet(nation, gender)}"), url("${portraitBackdrop(nation)}")`
});

import { levelForExperience } from "@shared/catalog/balance";

import { isCampaignExitId } from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { Campaign } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  TITLE_BACKGROUND_FILE, TITLE_MUSIC_FILE
} from "../../../../island-of-settlers-shared/src/game-settings/constants";
import { resolveEffectiveLevel } from "../../../../island-of-settlers-shared/src/game-settings/effective-rules";
import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { CampaignMapStatus } from "../../../../island-of-settlers-shared/src/script/engine/home-rewards";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import { CAMPAIGN_RUN_STATUSES, type CampaignRunStatus } from "../../shared/campaign/campaign-run";
import type { LocalCampaignProgress } from "../../shared/campaign/local-campaign-progress";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import { adminSettingsUrl, mapEditorUrl } from "../admin-links";
import { isOfflineMode, playsWithoutHome } from "../game-settings/session-mode";
import type { CampaignChoice } from "../settlement-ui/campaign-window/types";
import {
  TITLE_BACKGROUND_FILES, TITLE_FOLDER, TITLE_MUSIC_FILES, TITLE_VIDEO_EXTENSIONS
} from "./constants";

/** One entry of the title menu (plan §7.5); a disabled entry carries its reason as the tooltip. */
/** The administrator's links after Settings (owner 2026-11-13): other pages, opened in this tab. */
export type TitleAdminEntryId = "mapEditor" | "serverSettings";
export type TitleEntryId =
  | "campaigns" | "continue" | "load" | "multiplayer" | "newGame" | "settings" | TitleAdminEntryId;

export interface TitleEntryState {
  disabled: boolean;
  id: TitleEntryId;
  /** Why the entry is disabled; null while it works. */
  reason: "continueNone" | "multiplayerPlanned" | "noSaves" | "slotHoldsHome" | null;
}

/** The session's Save/Load slots as the menu sees them (SAVE-SLOTS); absent = slots off, automatic saving on. */
export interface TitleSlotFacts {
  /** Automatic saving on: Continue resumes the working slot; off: Continue loads the newest slot (owner §19.2). */
  autosave: boolean;
  /** Used save slots of this mode. */
  count: number;
  /** False when New game cannot reset the working slot (a signed-in cloud slot); absent = true. */
  resettable?: boolean;
}

export interface TitleMenuFacts {
  /** A signed-in administrator (`isAdministrator`): the menu ends with the admin links. */
  admin?: boolean;
  /** The working slot holds a game (a run on screen, or the home island). */
  hasSavedGame: boolean;
  /** The working slot keeps story progress between runs (no home): New game would reset it. */
  hasStoryProgress?: boolean;
  settings: GameSettings | null;
  slots?: TitleSlotFacts;
  /**
   * The signed-in cloud slot stores a home island game (owner Q4): it stays untouched and unused while the deployment
   * plays without a home, so Continue and Campaigns are disabled with the reason.
   */
  slotHoldsHome?: boolean;
}

const entry = (id: TitleEntryId, reason: TitleEntryState["reason"] = null): TitleEntryState =>
  ({ disabled: reason !== null, id, reason });

/**
 * Whether Continue has a game: the working slot with automatic saving on; the newest real save slot with it off
 * (owner answer §19.2: no crash-recovery offer, the working slot is technical then).
 */
export const canContinue = ({ hasSavedGame, slots }: Pick<TitleMenuFacts, "hasSavedGame" | "slots">) =>
  !slots || slots.autosave ? hasSavedGame : slots.count > 0;

const loadEntries = (slots: TitleSlotFacts | undefined) => (slots && slots.count > 0 ? [entry("load")] : []);

/**
 * With a home: Continue when there is a game, Load when slots exist, New game when there is nothing to continue
 * or slots keep the old game (it asks first), then Settings.
 */
const homeEntries = (facts: TitleMenuFacts) => {
  const continuable = canContinue(facts);
  return [
    ...continuable ? [entry("continue")] : [],
    ...loadEntries(facts.slots),
    ...!continuable || facts.slots ? [entry("newGame")] : [],
    entry("settings")
  ];
};

/** Without a home, New game resets the working slot's progress: only with slots and something to reset. */
const storyNewGame = ({ hasSavedGame, hasStoryProgress, slots }: TitleMenuFacts) =>
  slots && slots.resettable !== false && (hasSavedGame || hasStoryProgress) ? [entry("newGame")] : [];

/** Without a home, Load always shows while slots are on (owner 2026-11-12); with no save yet it says so. */
const storyLoad = (slots: TitleSlotFacts | undefined) =>
  slots ? [entry("load", slots.count > 0 ? null : "noSaves")] : [];

/** Multiplayer maps need a server: offline mode does not list the placeholder at all (owner 2026-11-12). */
const multiplayerEntries = (settings: GameSettings | null) =>
  isOfflineMode(settings) ? [] : [entry("multiplayer", "multiplayerPlanned")];

/**
 * The play entries per combination (plan §7.5): without a home Continue, Campaigns, Load, New game, the disabled
 * Multiplayer maps placeholder (online only) and Settings; with a home (offline, online with the game menu
 * before play, or a forced `?title=1`) see `homeEntries`.
 */
const playEntries = (facts: TitleMenuFacts): TitleEntryState[] => {
  if (!playsWithoutHome(facts.settings)) return homeEntries(facts);
  if (facts.slotHoldsHome)
    return [entry("continue", "slotHoldsHome"), entry("campaigns", "slotHoldsHome"),
      ...multiplayerEntries(facts.settings), entry("settings")];
  return [
    entry("continue", canContinue(facts) ? null : "continueNone"),
    entry("campaigns"),
    ...storyLoad(facts.slots),
    ...storyNewGame(facts),
    ...multiplayerEntries(facts.settings),
    entry("settings")
  ];
};

/** Where each admin entry leads, from the page at `href`. */
const TITLE_ADMIN_URLS: Readonly<Record<TitleAdminEntryId, (href: string) => string>> = Object.freeze({
  mapEditor: mapEditorUrl, serverSettings: adminSettingsUrl
});
const TITLE_ADMIN_ENTRY_IDS = Object.keys(TITLE_ADMIN_URLS) as TitleAdminEntryId[];

export const isTitleAdminEntry = (id: TitleEntryId): id is TitleAdminEntryId => Object.hasOwn(TITLE_ADMIN_URLS, id);

/**
 * The title menu: the play entries of the settings combination, then, for an administrator only, Map editor and
 * Server settings in every combination. The pages check the role themselves; these are links, not the gate.
 */
export const titleEntries = (facts: TitleMenuFacts): TitleEntryState[] => [
  ...playEntries(facts),
  ...facts.admin ? TITLE_ADMIN_ENTRY_IDS.map(id => entry(id)) : []
];

/**
 * The admin entries' actions: the page opens in this tab (no game runs yet; the browser's Back returns to the
 * title page), and leaving the page ends the session like a reload does.
 */
export const titleAdminActions = (page: Pick<Location, "assign" | "href">) => Object.fromEntries(
  TITLE_ADMIN_ENTRY_IDS.map(id => [id, () => page.assign(TITLE_ADMIN_URLS[id](page.href))])
) as Record<TitleAdminEntryId, () => void>;

export type TitleMode = "offline" | "online";

/** The mode line in the lower left corner (owner 2026-11-12). */
export const titleModeLabel = (settings: GameSettings | null): TitleMode =>
  isOfflineMode(settings) ? "offline" : "online";

const fileExtension = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/** How a title background file is shown. */
export const titleMediaKind = (name: string) =>
  TITLE_VIDEO_EXTENSIONS.includes(fileExtension(name)) ? "video" : "image";

const validName = (name: string | undefined, pattern: RegExp) => (name && pattern.test(name) ? [name] : []);

const withoutRepeats = (names: readonly string[]) => [...new Set(names)];

/** Background files in probe order: the admin's file name first (when valid), then the conventional names. */
export const titleBackgroundCandidates = (settings: GameSettings | null) =>
  withoutRepeats([...validName(settings?.titleScreen?.background, TITLE_BACKGROUND_FILE), ...TITLE_BACKGROUND_FILES]);

/** Music files in probe order: the admin's file name first (when valid), then the conventional names. */
export const titleMusicCandidates = (settings: GameSettings | null) =>
  withoutRepeats([...validName(settings?.titleScreen?.music, TITLE_MUSIC_FILE), ...TITLE_MUSIC_FILES]);

/** A title file's URL under the build's base path. */
export const titleFileUrl = (baseUrl: string, name: string) => `${baseUrl}${TITLE_FOLDER}${name}`;

/** The level a run without a home starts with: the rules' fixed level, else the slot's earned level. */
export const titlePlayerLevel = (settings: GameSettings, progress: PlayerProgress | null) =>
  resolveEffectiveLevel(settings.progression.levels, levelForExperience(progress?.experience ?? 0));

/** Campaigns the settings offer: `start.campaignIds` narrows the list; absent = every ready, offered campaign. */
export const offeredByTitle = (settings: GameSettings, campaign: Pick<Campaign, "id">) =>
  !settings.start.campaignIds || settings.start.campaignIds.includes(campaign.id);

/** What the run's end leaves for the title page (session value): the run and the campaign progress before it. */
export interface TitleLandingRecord {
  /** The campaign's progress before the run ended (map id → first victory's exit). */
  before: Readonly<Record<string, { exit: string }>>;
  campaignId: string;
  status: Exclude<CampaignRunStatus, "running">;
}

const ENDED_STATUSES = new Set<unknown>(CAMPAIGN_RUN_STATUSES.filter(status => status !== "running"));

const validBefore = (value: unknown) => isPlainObject(value) &&
  Object.values(value).every(entry => isPlainObject(entry) && isCampaignExitId(entry.exit));

/** The stored landing record when well-formed, else null (never thrown). */
export const parseTitleLanding = (json: string | null): TitleLandingRecord | null => {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!isPlainObject(value) || typeof value.campaignId !== "string" || !ENDED_STATUSES.has(value.status)) return null;
    return validBefore(value.before) ? value as unknown as TitleLandingRecord : null;
  } catch {
    return null;
  }
};

/** The landing record of an ended run: the campaign's progress before the end is kept as it was. */
export const titleLandingRecord = (
  run: Pick<TitleLandingRecord, "campaignId" | "status">, before: LocalCampaignProgress | undefined
): TitleLandingRecord => ({ before: { ...before?.[run.campaignId] }, campaignId: run.campaignId, status: run.status });

/** The campaign progress the record says existed before the run (for the "before" statuses). */
export const progressBeforeRun = (record: TitleLandingRecord, current: LocalCampaignProgress | undefined) =>
  ({ ...current, [record.campaignId]: record.before }) satisfies LocalCampaignProgress;

/** The map statuses of one campaign choice (`landingAfterRun` compares two of them). */
export const choiceStatuses = (choice: CampaignChoice | undefined): ReadonlyMap<string, CampaignMapStatus> =>
  new Map((choice?.maps ?? []).map(entry => [entry.map.id, entry.status]));

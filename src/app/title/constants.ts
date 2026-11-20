import type { QualityLevel } from "../../render-common/quality";
import { TITLE_MESSAGES as M } from "./messages";

/** The conventional folder of the title files under the build's public base (owner 2026-11-12). */
export const TITLE_FOLDER = "title/";
/** Conventional title backgrounds in probe order: a video wins over an image. */
export const TITLE_BACKGROUND_FILES = Object.freeze([
  "title-background.webm", "title-background.mp4", "title-background.webp", "title-background.jpg",
  "title-background.png"
]);
export const TITLE_MUSIC_FILES = Object.freeze(["title-music.ogg", "title-music.mp3"]);
export const TITLE_VIDEO_EXTENSIONS = Object.freeze(["mp4", "webm"]);
/** A probe answer must carry one of these media types: a dev server answers a missing file with the page. */
export const TITLE_MEDIA_TYPES = Object.freeze({ audio: "audio/", image: "image/", video: "video/" });
/** The probe's patience per file; a slower answer counts as missing. */
export const TITLE_PROBE_TIMEOUT_MS = 2500;
/** Session value of the landing after a run without a home (written before the reload to the title page). */
export const TITLE_LANDING_KEY = "island-title-landing";
/** URL parameters the title page consumes; removed once the game starts. */
export const TITLE_CONSUMED_PARAMS = Object.freeze(["title"]);
/** Named HUD icons of the title entries and the landing dialog's choices. */
export const TITLE_ENTRY_ICONS = Object.freeze({
  campaigns: "campaign", continue: "musicPlay", load: "import", mapEditor: "mapEditor", multiplayer: "handshake",
  newGame: "build", serverSettings: "scroll", settings: "settings"
});
export const TITLE_LANDING_ICONS = Object.freeze({
  campaignSelection: "campaign", choosePath: "map", exit: "cancel", nextMap: "pageNext"
});
export const TITLE_ENTRY_LABELS = Object.freeze({
  campaigns: M.campaigns, continue: M.continue, load: M.load, mapEditor: M.admin.mapEditor,
  multiplayer: M.multiplayer, newGame: M.newGame, serverSettings: M.admin.serverSettings,
  settings: M.settings.heading
});
/** Author line in the title page's lower right corner; a name, so it is not translated. */
export const TITLE_CREDIT = "shadowvzs, 2026";
/** The title page's Detail slider before the player ever chose one (the game's own probe runs on first load). */
export const DEFAULT_TITLE_DETAIL: QualityLevel = "medium";
/** A title start without a home-less rule set or without the chosen map (English domain refusal). */
export const NO_CAMPAIGN_START = "This game cannot start a campaign map";

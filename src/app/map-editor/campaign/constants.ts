import { LANGUAGE_OPTIONS } from "../../../shared/i18n/locales";
import type { CampaignEditorState } from "./campaign-editor-state";

/** Campaign mode of `editor.html` (lane C6): URL contract, ids and editor limits. */

/** `editor.html?mode=campaign` opens the campaign editor instead of the 3D map editor. */
export const EDITOR_MODE_PARAM = "mode";
export const CAMPAIGN_EDITOR_MODE = "campaign";
/** The campaign (and map) the campaign editor selects on open. */
export const CAMPAIGN_ID_PARAM = "campaign";
export const CAMPAIGN_MAP_ID_PARAM = "campaignMap";
/** The map editor opened from a campaign: its map lives in this `island-maps` slot, never in World01. */
export const CAMPAIGN_SLOT_PARAM = "campaignSlot";
/** Campaign map files are `island-maps` slots keyed `campaign/<campaignId>/<mapId>` (plan item 41). */
export const CAMPAIGN_SLOT_PREFIX = "campaign/";
/** Leaving the 3D editor drops unsaved map edits (the editor bar is English-only, like its labels). */
export const LEAVE_FOR_CAMPAIGN_QUESTION = "Open the campaign editor? Unsaved map edits are lost.";

export const CAMPAIGN_ID_PREFIX = "campaign";
export const CAMPAIGN_MAP_ID_PREFIX = "map";
export const CAMPAIGN_IMAGE_ID_PREFIX = "image";
export const CAMPAIGN_SPEAKER_ID_PREFIX = "speaker";
/** Portrait slots in editor order: the required neutral one first (CIN1 expressions). */
export const SPEAKER_EXPRESSIONS = ["neutral", "happy", "worried", "angry", "surprised"] as const;
/** The two story messages of a map the Story tab edits: intro (map start) and epilogue (victory). */
export type StoryKind = "intro" | "epilogue";
export const STORY_KINDS: readonly StoryKind[] = ["intro", "epilogue"];
/** Default quest ids of the story messages (a numeric suffix keeps them unique). */
export const STORY_QUEST_ID: Readonly<Record<StoryKind, string>> = { epilogue: "story-epilogue", intro: "story-intro" };
/** The quest trigger of each story message. */
export const STORY_TRIGGER: Readonly<Record<StoryKind, "mapStart" | "victory">> = {
  epilogue: "victory", intro: "mapStart"
};
/** Radix of the time part of generated ids (short, sortable, identifier-safe). */
export const ID_TIME_RADIX = 36;
export const ID_RANDOM_LENGTH = 4;

/** The drag payload type of a map row (HTML drag and drop; the arrow buttons are the keyboard path). */
export const MAP_ROW_DRAG_TYPE = "application/x-campaign-map-index";

/** Map view: default node layout runs left to right and zig-zags between these rows. */
export const NODE_LAYOUT_MARGIN = 0.12;
export const NODE_LAYOUT_UPPER_ROW = 0.35;
export const NODE_LAYOUT_LOWER_ROW = 0.65;
/** Nodes the default layout spreads across before it starts again at the left. */
export const NODE_LAYOUT_SLOTS = 8;
/** Arrow keys move a focused node by this fraction (Shift: ten times). */
export const NODE_NUDGE_STEP = 0.01;
export const NODE_NUDGE_FAST_FACTOR = 10;
/** Arrow key → u,v direction of a node nudge. */
export const NODE_NUDGE_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1]
};
/** Node positions are stored rounded to this many decimals (sub-pixel noise stays out of the documents). */
export const NODE_POSITION_DECIMALS = 4;
/** Width / height of the map view while the campaign has no image. */
export const MAP_VIEW_FALLBACK_ASPECT = 1.6;
/** SVG overlay height in user units (the width is this × the image aspect, so shapes keep their proportions). */
export const MAP_VIEW_BOX = 100;
/** Arrows stop this far (overlay units, 100 = image height) from a node centre, at about the node rim. */
export const MAP_PATH_NODE_GAP = 4.5;
/** The end marker of an ending map sits this far right of and above its node (overlay units). */
export const MAP_ENDING_OFFSET = 7;
/** Ring radius of the end marker (overlay units). */
export const MAP_ENDING_RADIUS = 1.8;
/** Arrowhead of the map view paths: length and half width (overlay units). */
export const MAP_ARROW_LENGTH = 3;
export const MAP_ARROW_HALF_WIDTH = 1.6;
export const MAP_ARROW_SIZE = { halfWidth: MAP_ARROW_HALF_WIDTH, length: MAP_ARROW_LENGTH };
/** Shorter joins (overlapping nodes) draw no arrow: both node rims and the head must fit. */
export const MAP_ARROW_MINIMUM = 2 * MAP_PATH_NODE_GAP + MAP_ARROW_LENGTH;
export const PERCENT = 100;

/** Raw files above this are refused before decoding (the stored WebP is ≤ 300 KB anyway). */
export const RAW_IMAGE_MAX_BYTES = 20_971_520;
export const RAW_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
/** WebP qualities tried from best to smallest, at each scale step, until the file fits the size limit. */
const WEBP_QUALITY_HIGH = 0.86;
const WEBP_QUALITY_MEDIUM = 0.74;
const WEBP_QUALITY_LOW = 0.62;
export const WEBP_QUALITIES: readonly number[] = [WEBP_QUALITY_HIGH, WEBP_QUALITY_MEDIUM, WEBP_QUALITY_LOW];
/** Scale steps after fitting into 1024 px: full, 80 %, 64 %, half. */
const SCALE_STEP_LARGE = 0.8;
const SCALE_STEP_MEDIUM = 0.64;
export const IMAGE_SCALE_STEPS: readonly number[] = [1, SCALE_STEP_LARGE, SCALE_STEP_MEDIUM, 0.5];

/** Highest minimum player level the map form accepts. */
export const MAX_MINIMUM_LEVEL = 100;
/** Length of an ISO `YYYY-MM-DD` date. */
export const ISO_DATE_LENGTH = 10;
export const KILOBYTE = 1024;
/** The status message key of each upload refusal reason (CAMPAIGN_EDITOR_MESSAGES.status). */
export const IMAGE_REFUSAL_TEXT = {
  tooDetailed: "imageTooDetailed", tooLarge: "imageTooLarge", unreadable: "imageUnreadable"
} as const;

export const INITIAL_CAMPAIGN_EDITOR_STATE: CampaignEditorState = {
  artworkConfirmed: false,
  busy: false,
  campaigns: [],
  confirmation: null,
  dirty: false,
  draft: null,
  images: {},
  jump: null,
  loaded: false,
  maps: [],
  notice: null,
  report: null,
  server: "none",
  selectedMapId: null,
  storage: "local",
  textEdits: []
};

/** Heading id of the delete confirmation panel (its accessible name). */
export const DELETE_CONFIRMATION_TITLE_ID = "campaign-editor-delete-title";

/** The section tabs of an open campaign, in order (the Check panel jumps to them by id). */
export const WORKSPACE_TAB_IDS = [
  "details", "maps", "map-view", "story", "speakers", "translations", "validation"
] as const;
export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number];

/** Languages the campaign Check and the translation table cover: every game language, English first. */
export const CAMPAIGN_CHECK_LANGUAGES: readonly string[] = LANGUAGE_OPTIONS.map(option => option.locale);

/** Check panel groups inside a document, in display order. */
export const CHECK_CATEGORIES = ["script", "translation", "path", "reference", "reward", "other"] as const;
export type CheckCategory = (typeof CHECK_CATEGORIES)[number];
/** Issue codes (campaign and script tables) that report a missing or malformed player text. */
export const CHECK_TRANSLATION_CODES: ReadonlySet<string> = new Set([
  "invalidTranslationKey", "missingEnglishText", "missingFallbackText", "missingTranslation"
]);
/** Campaign issue codes that report a reference to something deleted, foreign or unknown. */
export const CHECK_REFERENCE_CODES: ReadonlySet<string> = new Set([
  "campaignImageDeleted", "campaignMapFileMissing", "campaignMapMissing", "campaignMapNotOwned",
  "missingActorReference", "missingCueReference", "missingImage", "missingPortraitImage", "missingQuestReference",
  "missingRegionReference", "missingScenarioBuilding", "missingSequenceReference", "missingShotReference",
  "missingSpeakerExpression", "missingSpeakerReference", "unknownBuildingType", "unknownUnitType", "unknownWare"
]);
/** Campaign graph issue codes (BR0/BR3): start maps, paths and exits; fixed in the Maps and Details tabs. */
export const CHECK_PATH_CODES: ReadonlySet<string> = new Set([
  "campaignCycle", "campaignEdgeDuplicate", "campaignEdgeUnknownExit", "campaignEdgeUnknownMap",
  "campaignExitWithoutEdge", "campaignMapUnreachable", "campaignNoEnding", "campaignNoStartMap",
  "campaignPreviousMapLockUnused", "campaignStartHasIncoming"
]);
/** Issue codes that are reward problems wherever they are reported. */
export const CHECK_REWARD_CODES: ReadonlySet<string> = new Set([
  "homeRewardBeforeCompletionProof", "invalidReward", "repeatableHomeReward"
]);
/** A reward field anywhere in an issue path (`rewards.goods[0]`, `quests[2].homeReward`). */
export const CHECK_REWARD_PATH = /reward/i;

/** Between the parts of a readable issue path ("Trigger "Intro" › first value"). */
export const CHECK_PATH_SEPARATOR = " › ";
/** Map record fields the Maps tab edits (other map fields are edited in the map editor). */
export const MAP_SETTINGS_FIELDS: ReadonlySet<string> =
  new Set(["exits", "name", "requiredCargo", "rewards", "soldierCap", "unlock"]);

/** Text edits the translation table can undo (older ones are dropped). */
export const TEXT_UNDO_LIMIT = 100;
/** DOM id prefix of a translation table cell (`<prefix>:<text id>:<language>`); jumps focus it. */
export const TEXT_CELL_ID_PREFIX = "campaign-text";

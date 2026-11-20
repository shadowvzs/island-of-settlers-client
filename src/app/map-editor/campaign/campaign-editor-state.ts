import type { CampaignValidationResult } from "../../../../../island-of-settlers-shared/src/campaign/campaign-issues";
import type { Campaign, CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { ScriptIssue, ScriptValidationResult } from "../../../../../island-of-settlers-shared/src/script/issues";
import type { EditorText } from "../messages";
import type { ScriptPathNames } from "./check/path-labels";
import type { WorkspaceTabId } from "./constants";

/** A status line under the toolbar; errors use the warning tone. */
export interface CampaignEditorNotice {
  error: boolean;
  text: EditorText;
}

/** A stored campaign image shown in the editor (object URL of its WebP bytes). */
export interface CampaignImageView {
  height: number;
  url: string;
  width: number;
}

/**
 * One checked map: its record's Ready result and, in a whole-campaign Check, the reward lines and the map file's
 * script Ready check (null: the file has no script or was never saved).
 */
export interface CampaignMapCheck {
  mapId: string;
  result: CampaignValidationResult;
  rewards?: readonly ScriptIssue[];
  script?: ScriptValidationResult | null;
  /** Names of the script's triggers, quests, variables, actors and home rewards, for readable issue paths. */
  scriptNames?: ScriptPathNames;
}

/** The last Ready check: the campaign document and every checked map, language-neutral (formatted by the view). */
export interface CampaignReadyReport {
  campaign: CampaignValidationResult;
  /** Reward line problems of the campaign reward (whole-campaign Check only). */
  campaignRewards?: readonly ScriptIssue[];
  maps: readonly CampaignMapCheck[];
}

/** A request to show a section tab (and focus a translation table cell there); a new revision applies it. */
export interface CampaignEditorJump {
  language?: string;
  revision: number;
  tab: WorkspaceTabId;
  textId?: string;
}

/** One undoable translation table edit: the cell and the value it had before. */
export interface CampaignTextEdit {
  language: string;
  previous: string;
  textId: string;
}

/**
 * A pending deletion shown in the confirmation panel (owner 2026-11-11): what it removes, counted, and by name.
 * Nothing is deleted until the panel confirms.
 */
export interface CampaignDeleteConfirmation {
  id: string;
  imageCount: number;
  kind: "campaign" | "map";
  mapCount: number;
  name: string;
}

/** Where the records live: IndexedDB, or memory when the browser blocks storage (lost on close). */
export type CampaignStorageKind = "local" | "memory";

/** The server sync: unavailable (offline or not an administrator), available, or failed at the last try. */
export type CampaignServerState = "connected" | "failed" | "none";

/**
 * The campaign editor's UI state. `campaigns` are the saved records (list), `draft` and `maps` the working copies
 * of the selected campaign; edits stay local until Save (or an action that saves, such as deleting a map).
 */
export interface CampaignEditorState {
  artworkConfirmed: boolean;
  busy: boolean;
  campaigns: readonly Campaign[];
  confirmation: CampaignDeleteConfirmation | null;
  dirty: boolean;
  draft: Campaign | null;
  images: Readonly<Record<string, CampaignImageView>>;
  jump: CampaignEditorJump | null;
  loaded: boolean;
  maps: readonly CampaignMap[];
  notice: CampaignEditorNotice | null;
  report: CampaignReadyReport | null;
  selectedMapId: string | null;
  server: CampaignServerState;
  storage: CampaignStorageKind;
  /** Undo stack of the translation table (newest last); cleared with the selection. */
  textEdits: readonly CampaignTextEdit[];
}

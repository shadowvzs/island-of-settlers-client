import type { I18n } from "@lingui/core";
import { audioEntries, type AudioKind, audioPayload, categoriesOfKind } from "@shared/catalog";

import {
  type AudioRef, checkMapAudioAssets, MAP_AUDIO_LIMITS, type MapAudioAsset, mapAudioAssetRefusal,
  type MapAudioRefusal
} from "../../../../../island-of-settlers-shared/src/script/audio";
import { contentDescriptor } from "../../../shared/i18n/content-text";
import { translateMessage } from "../../../shared/i18n/translate";
import { AUDIO_ASSET_ID_PREFIX, AUDIO_UPLOADS_TAB_ID } from "./constants";
import { SCRIPT_MESSAGES as M } from "./messages";

/**
 * The audio picker's pure model (AUDIO-CATALOG): category tabs of the catalog's sounds or music plus the map's
 * uploads, the search filter, the summaries of stored references and the upload bookkeeping.
 */

export interface AudioOption {
  /** Duration "m:ss". */
  detail: string;
  key: string;
  label: string;
  selected: boolean;
  /** Uploaded with the map (removable). */
  uploaded: boolean;
  value: AudioRef;
}

export interface AudioTab {
  id: string;
  label: string;
  options: AudioOption[];
}

const SECONDS_PER_MINUTE = 60;
const BYTES_PER_KILOBYTE = 1024;

/** "4:09" for 249 s; sub-second sounds read "0:01". */
export const formatAudioDuration = (seconds: number) => {
  const whole = Math.max(1, Math.round(seconds));
  return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${String(whole % SECONDS_PER_MINUTE).padStart(2, "0")}`;
};

const isSameRef = (ref: AudioRef, value: unknown) => {
  const other = value as Partial<{ assetId: string; id: string; kind: string }> | null | undefined;
  if (!other || other.kind !== ref.kind) return false;
  return ref.kind === "catalog" ? other.id === ref.id : other.assetId === ref.assetId;
};

const matches = (label: string, query: string) => label.toLowerCase().includes(query.trim().toLowerCase());

const catalogTabs = (kind: AudioKind, query: string, value: unknown, i18n: I18n | undefined): AudioTab[] => {
  const entries = audioEntries(kind);
  return categoriesOfKind(kind).map(category => ({
    id: category.id,
    label: translateMessage(i18n, contentDescriptor(category.text.name)),
    options: entries.filter(entry => entry.category === category.id).map(entry => {
      const ref: AudioRef = { id: entry.id, kind: "catalog" };
      return {
        detail: formatAudioDuration(audioPayload(entry).durationSeconds), key: entry.id,
        label: translateMessage(i18n, contentDescriptor(entry.text.name)), selected: isSameRef(ref, value),
        uploaded: false, value: ref
      };
    }).filter(option => matches(option.label, query))
  }));
};

const uploadsTab = (
  kind: AudioKind, assets: readonly MapAudioAsset[], query: string, value: unknown, i18n: I18n | undefined
): AudioTab => ({
  id: AUDIO_UPLOADS_TAB_ID,
  label: translateMessage(i18n, M.audio.uploadsTab),
  options: assets.filter(asset => asset.kind === kind && matches(asset.name, query)).map(asset => {
    const ref: AudioRef = { assetId: asset.id, kind: "upload" };
    return { detail: formatAudioDuration(asset.durationSeconds), key: `upload:${asset.id}`, label: asset.name,
      selected: isSameRef(ref, value), uploaded: true, value: ref };
  })
});

/** Category tabs of the catalog entries of `kind`, then the uploads tab; `query` filters the names. */
export const audioPickerTabs = (
  kind: AudioKind, assets: readonly MapAudioAsset[], query: string, value: unknown, i18n?: I18n
): AudioTab[] => [...catalogTabs(kind, query, value, i18n), uploadsTab(kind, assets, query, value, i18n)];

/** The tab holding the stored value (the first tab when unset or unknown). */
export const initialAudioTabId = (tabs: readonly AudioTab[]) =>
  (tabs.find(tab => tab.options.some(option => option.selected)) ?? tabs[0])?.id ?? AUDIO_UPLOADS_TAB_ID;

/** The summary of a stored audio reference: the entry's name, or the uploaded file's label. */
export const describeAudioRef = (ref: AudioRef, assets: readonly MapAudioAsset[], i18n?: I18n): string => {
  if (ref.kind === "upload") return assets.find(asset => asset.id === ref.assetId)?.name ?? ref.assetId;
  const entry = [...audioEntries("sound"), ...audioEntries("music")].find(item => item.id === ref.id);
  return entry ? translateMessage(i18n, contentDescriptor(entry.text.name)) : ref.id;
};

/** The next free `audio-<n>` id (ids are never reused within the list). */
export const nextAudioAssetId = (assets: readonly Pick<MapAudioAsset, "id">[]) => {
  const numbers = assets.map(asset => Number(asset.id.slice(AUDIO_ASSET_ID_PREFIX.length))).filter(Number.isFinite);
  return `${AUDIO_ASSET_ID_PREFIX}${Math.max(0, ...numbers) + 1}`;
};

/** A file name as an asset label: without its extension, within the name limit. */
export const audioAssetName = (fileName: string) =>
  (fileName.replace(/\.[A-Za-z0-9]+$/, "").trim() || fileName).slice(0, MAP_AUDIO_LIMITS.nameLength);

export type AudioUploadResult = { assets: MapAudioAsset[] } | { refusal: MapAudioRefusal };

/** The list with one more upload, or why it is refused (file limits first, then the map's count and total). */
export const withUploadedAudio = (assets: readonly MapAudioAsset[], asset: MapAudioAsset): AudioUploadResult => {
  const refusal = mapAudioAssetRefusal(asset);
  if (refusal) return { refusal };
  const next = [...assets, asset];
  const listIssue = checkMapAudioAssets(next)[0];
  return listIssue ? { refusal: listIssue.reason } : { assets: next };
};

const REFUSAL_MESSAGES = {
  duplicateId: M.audio.refusal.invalid, invalidAsset: M.audio.refusal.invalid, tooLarge: M.audio.refusal.tooLarge,
  tooLong: M.audio.refusal.tooLong, tooManyAssets: M.audio.refusal.tooMany,
  totalTooLarge: M.audio.refusal.totalTooLarge, unsupportedFormat: M.audio.refusal.format
} as const;

/** The refusal as a complete sentence with the limits of `kind`. */
export const audioRefusalText = (refusal: MapAudioRefusal, kind: AudioKind, i18n?: I18n) =>
  translateMessage(i18n, REFUSAL_MESSAGES[refusal], {
    count: MAP_AUDIO_LIMITS.assets, kilobytes: Math.round(MAP_AUDIO_LIMITS[kind].bytes / BYTES_PER_KILOBYTE),
    seconds: MAP_AUDIO_LIMITS[kind].seconds,
    totalKilobytes: Math.round(MAP_AUDIO_LIMITS.totalBytes / BYTES_PER_KILOBYTE)
  });

/** "Sounds: OGG or MP3, at most 256 KB and 15 s." */
export const audioLimitsText = (kind: AudioKind, i18n?: I18n) => translateMessage(i18n, M.audio.limits, {
  kilobytes: Math.round(MAP_AUDIO_LIMITS[kind].bytes / BYTES_PER_KILOBYTE), seconds: MAP_AUDIO_LIMITS[kind].seconds
});

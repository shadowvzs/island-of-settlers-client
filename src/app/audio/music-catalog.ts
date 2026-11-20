import type { MessageDescriptor } from "@lingui/core";
import { musicEntries } from "@shared/catalog";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { audioEntryUrl } from "./audio-asset-urls";
import { MUSIC_MESSAGES } from "./messages";

export type MusicCollection = WorkerNation | "neutral";
export interface MusicTrack {
  collection: MusicCollection | "local";
  /** Cue id of a track without a bundled file name (an uploaded map track: `upload:<assetId>`). */
  id?: string;
  name: string;
  filename?: string;
  url: string;
}
export const MUSIC_COLLECTIONS: readonly {
  label: MessageDescriptor;
  value: MusicCollection | "all" | "local";
}[] = [
  { label: MUSIC_MESSAGES.collection.all, value: "all" },
  { label: MUSIC_MESSAGES.collection.roman, value: "roman" },
  { label: MUSIC_MESSAGES.collection.viking, value: "viking" },
  { label: MUSIC_MESSAGES.collection.japanese, value: "japanese" },
  { label: MUSIC_MESSAGES.collection.nubian, value: "nubian" },
  { label: MUSIC_MESSAGES.collection.chinese, value: "chinese" },
  { label: MUSIC_MESSAGES.collection.persian, value: "persian" },
  { label: MUSIC_MESSAGES.collection.maya, value: "maya" },
  { label: MUSIC_MESSAGES.collection.indigenous, value: "indigenous" },
  { label: MUSIC_MESSAGES.collection.neutral, value: "neutral" },
  { label: MUSIC_MESSAGES.collection.local, value: "local" }
];
/** The bundled tracks of the shared content catalog (`music:*`), in catalog order. */
export const bundledMusicTracks = (): MusicTrack[] => musicEntries().map(entry => {
  const url = audioEntryUrl(entry);
  if (!url) throw new Error(`Bundled music file missing: ${entry.id}`);
  return {
    collection: entry.music.collection as MusicCollection, filename: `${entry.key}.ogg`, name: entry.text.name.en, url
  };
});
export const musicForCollection = (tracks: readonly MusicTrack[], collection: string) => {
  if (collection === "all") return [...tracks];
  const selected = tracks.filter(track => track.collection === collection);
  return selected;
};

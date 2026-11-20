import { audioEntry, type AudioKind, audioPayload } from "@shared/catalog";

import type { AudioRef, MapAudioAsset } from "../../../../island-of-settlers-shared/src/script/audio";
import { audioEntryUrl } from "./audio-asset-urls";
import { UPLOADED_TRACK_ID_PREFIX } from "./constants";

/** What an audio reference plays: a synthesized cue, or a file (bundled URL or the uploaded bytes). */
export type ResolvedAudio =
  | { cue: string; kind: "cue"; name: string }
  | { id: string; kind: "file"; name: string; url: string };

/** Looks an uploaded map audio asset up by id (`world.audioAssets`). */
export type AudioUploadLookup = (assetId: string) => MapAudioAsset | undefined;

/** The uploaded bytes as a URL an audio element plays (no object URL to revoke). */
export const mapAudioAssetUrl = (asset: Pick<MapAudioAsset, "data" | "mimeType">) =>
  `data:${asset.mimeType};base64,${asset.data}`;

const resolveUpload = (assetId: string, kind: AudioKind, uploads: AudioUploadLookup): ResolvedAudio | null => {
  const asset = uploads(assetId);
  if (!asset || asset.kind !== kind) return null;
  return { id: `${UPLOADED_TRACK_ID_PREFIX}${asset.id}`, kind: "file", name: asset.name, url: mapAudioAssetUrl(asset) };
};

/** Resolves a script audio reference of `kind`; null for an unknown, retired or wrong-kind reference. */
export const resolveAudioRef = (ref: AudioRef, kind: AudioKind, uploads: AudioUploadLookup): ResolvedAudio | null => {
  if (ref.kind === "upload") return resolveUpload(ref.assetId, kind, uploads);
  const entry = audioEntry(kind, ref.id);
  if (!entry) return null;
  const { source } = audioPayload(entry);
  const name = entry.text.name.en;
  if (source.kind === "cue") return { cue: source.cue, kind: "cue", name };
  const url = audioEntryUrl(entry);
  return url ? { id: entry.key, kind: "file", name, url } : null;
};

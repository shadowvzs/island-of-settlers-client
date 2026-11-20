import type { AudioKind } from "@shared/catalog";

import {
  MAP_AUDIO_LIMITS, MAP_AUDIO_MIME_TYPES, type MapAudioAsset, type MapAudioMimeType, type MapAudioRefusal
} from "../../../../../island-of-settlers-shared/src/script/audio";
import { bytesToBase64 } from "../../base64";
import { audioAssetName } from "./audio-picker-model";

const EXTENSION_MIME_TYPES: Readonly<Record<string, MapAudioMimeType>> = { mp3: "audio/mpeg", ogg: "audio/ogg" };

/** The stored MIME type of an upload by its declared type, else its extension; null for another format. */
export const audioUploadMimeType = (file: Pick<File, "name" | "type">): MapAudioMimeType | null => {
  const declared = file.type.split(";")[0];
  if ((MAP_AUDIO_MIME_TYPES as readonly string[]).includes(declared ?? "")) return declared as MapAudioMimeType;
  return EXTENSION_MIME_TYPES[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ?? null;
};

/** Duration of an audio blob from its metadata (browser only); null when it cannot be decoded. */
const readDuration = (blob: Blob) => new Promise<number | null>(resolve => {
  const url = URL.createObjectURL(blob);
  const probe = new Audio();
  const finish = (seconds: number | null) => {
    URL.revokeObjectURL(url);
    resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
  };
  probe.preload = "metadata";
  probe.addEventListener("loadedmetadata", () => finish(probe.duration), { once: true });
  probe.addEventListener("error", () => finish(null), { once: true });
  probe.src = url;
});

export type AudioUploadRead = { asset: MapAudioAsset } | { refusal: MapAudioRefusal };

/**
 * Reads an uploaded OGG / MP3 as a map audio asset: format and size are refused before the bytes are read, the
 * duration comes from the file's metadata. The caller adds it to the map (`withUploadedAudio`).
 */
export const readAudioUpload = async (
  file: File, kind: AudioKind, id: string, duration: (blob: Blob) => Promise<number | null> = readDuration
): Promise<AudioUploadRead> => {
  const mimeType = audioUploadMimeType(file);
  if (!mimeType) return { refusal: "unsupportedFormat" };
  if (file.size > MAP_AUDIO_LIMITS[kind].bytes) return { refusal: "tooLarge" };
  const durationSeconds = await duration(file);
  if (durationSeconds === null) return { refusal: "invalidAsset" };
  const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  return { asset: { data, durationSeconds, id, kind, mimeType, name: audioAssetName(file.name) } };
};

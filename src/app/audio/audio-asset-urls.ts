import type { AssetRef, AudioEntry } from "@shared/catalog";
import { audioPayload } from "@shared/catalog";

const ASSET_FOLDER = "../../../assets/";
// Eager imports resolve URLs only. Audio is fetched on playback, never decoded as a whole catalog.
const audioFiles = import.meta.glob<string>("../../../assets/audio/**/*.{ogg,mp3}", {
  eager: true, import: "default", query: "?url"
});

/** The bundled URL of a shipped audio asset (`clientAssets` root); null for an unknown file. */
export const audioAssetUrl = (asset: AssetRef): string | null =>
  (asset.root === "clientAssets" ? audioFiles[`${ASSET_FOLDER}${asset.path}`] ?? null : null);

/** The URL of a file-backed catalog entry; null for synthesized cues. */
export const audioEntryUrl = (entry: AudioEntry): string | null => {
  const { source } = audioPayload(entry);
  return source.kind === "file" ? audioAssetUrl(source.file) : null;
};

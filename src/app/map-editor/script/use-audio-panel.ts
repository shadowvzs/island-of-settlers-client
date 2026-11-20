import { useLingui } from "@lingui/react";
import type { AudioKind } from "@shared/catalog";
import { useEffect, useMemo, useRef, useState } from "react";

import type { MapAudioAsset } from "../../../../../island-of-settlers-shared/src/script/audio";
import { translateMessage } from "../../../shared/i18n/translate";
import { resolveAudioRef } from "../../audio/audio-refs";
import {
audioLimitsText,   type AudioOption, audioPickerTabs, audioRefusalText, initialAudioTabId, nextAudioAssetId,
  withUploadedAudio
} from "./audio-picker-model";
import { createAudioPreview } from "./audio-preview";
import { readAudioUpload } from "./audio-upload";
import { AUDIO_UPLOADS_TAB_ID } from "./constants";
import { SCRIPT_MESSAGES as M } from "./messages";
import type { ScriptWorkspace } from "./script-workspace";
import { useWorkspaceState } from "./use-script-workspace";

/** One preview at a time; the playing option's key is view state so its button shows Stop. */
const useAudioPreview = (kind: AudioKind, assets: readonly MapAudioAsset[]) => {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const preview = useRef<ReturnType<typeof createAudioPreview> | null>(null);
  useEffect(() => {
    const created = createAudioPreview({ onEnd: () => setPlayingKey(null) });
    preview.current = created;
    return () => {
      created.dispose();
      preview.current = null;
    };
  }, []);
  const toggle = (option: AudioOption) => {
    if (playingKey === option.key) {
      preview.current?.stop();
      setPlayingKey(null);
      return;
    }
    const audio = resolveAudioRef(option.value, kind, assetId => assets.find(asset => asset.id === assetId));
    const playsOn = audio ? preview.current?.play(audio) ?? false : false;
    setPlayingKey(playsOn ? option.key : null);
  };
  const stop = () => {
    preview.current?.stop();
    setPlayingKey(null);
  };
  return { playingKey, stop, toggle };
};

/**
 * The audio picker's view model: category tabs with a name search, a preview play / stop button per entry, and
 * the uploads tab with the "own or licence-free" confirmation, the upload and the removal of uploaded files.
 */
export const useAudioPanel = (
  workspace: ScriptWorkspace, kind: AudioKind, value: unknown, onChoose: (value: unknown) => void
) => {
  const { i18n } = useLingui();
  const { audioAssets } = useWorkspaceState(workspace);
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const tabs = useMemo(() => audioPickerTabs(kind, audioAssets, query, value, i18n),
    [kind, audioAssets, query, value, i18n]);
  const [tabId, setTabId] = useState(() => initialAudioTabId(tabs));
  const preview = useAudioPreview(kind, audioAssets);
  const active = tabs.find(tab => tab.id === tabId) ?? tabs[0]!;
  const upload = async (file: File) => {
    setBusy(true);
    const read = await readAudioUpload(file, kind, nextAudioAssetId(audioAssets));
    const result = "asset" in read ? withUploadedAudio(audioAssets, read.asset) : read;
    setBusy(false);
    if ("refusal" in result) return setRefusal(audioRefusalText(result.refusal, kind, i18n));
    setRefusal("");
    workspace.setAudioAssets(result.assets);
  };
  const remove = (option: AudioOption) => {
    if (option.value.kind !== "upload") return;
    const { assetId } = option.value;
    preview.stop();
    workspace.setAudioAssets(audioAssets.filter(asset => asset.id !== assetId));
  };
  return {
    confirmed,
    confirmLabel: translateMessage(i18n, M.audio.confirmOwn),
    limitsText: audioLimitsText(kind, i18n),
    noMatchesLabel: translateMessage(i18n, M.audio.noMatches),
    options: active.options.map(option => {
      const playing = preview.playingKey === option.key;
      return {
        ...option,
        previewIcon: playing ? "previewStop" as const : "previewPlay" as const,
        previewLabel: translateMessage(i18n, playing ? M.audio.stopPreview : M.audio.preview, { name: option.label }),
        removeLabel: translateMessage(i18n, M.audio.remove, { name: option.label })
      };
    }),
    query,
    refusal,
    searchLabel: translateMessage(i18n, M.audio.search),
    showsUpload: active.id === AUDIO_UPLOADS_TAB_ID,
    tabs: tabs.map(tab => ({ count: tab.options.length, id: tab.id, label: tab.label, selected: tab.id === active.id })),
    tabsLabel: translateMessage(i18n, M.audio.tabs),
    uploadDisabled: busy || !confirmed,
    uploadLabel: translateMessage(i18n, M.audio.upload),
    onChoose: (option: AudioOption) => onChoose(option.value),
    onConfirm: setConfirmed,
    onPreview: preview.toggle,
    onQuery: setQuery,
    onRemove: remove,
    onTab: setTabId,
    onUpload: (file: File) => { void upload(file); }
  };
};

export type AudioPanelView = ReturnType<typeof useAudioPanel>;

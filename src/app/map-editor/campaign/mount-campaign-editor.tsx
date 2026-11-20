import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import { openCampaignIndexedDbRepositories } from "../../campaign-storage/campaign-indexeddb-store";
import { mountReactIsland } from "../../components/react-island";
import { languagePreference } from "../../localization/language-store";
import { editorGameSettings } from "../map-rules/editor-game-settings";
import { openMapStorage } from "../map-storage";
import { resolveEditorText } from "../messages";
import { createCampaignEditor } from "./campaign-editor";
import { CampaignEditorApp } from "./campaign-editor-app";
import { readCampaignSelection } from "./helpers";
import { processCampaignImage } from "./image-processing";
import { openCampaignServerSync } from "./open-server-sync";

/** The local repository (IndexedDB), or memory when the browser blocks storage (owner: IndexedDB local). */
const openRepositories = async () => {
  const local = await openCampaignIndexedDbRepositories();
  if (local) return { repositories: local, storage: "local" as const };
  const repositories = createStoreCampaignRepositories(createMemoryCampaignRecordStore());
  return { repositories, storage: "memory" as const };
};

/**
 * Starts the campaign editor (C6) in `host`: repositories, map file slots, the server sync (administrators online)
 * and the browser services, then the React view. Returns the unmount.
 */
export const mountCampaignEditor = async (host: HTMLElement) => {
  const [{ repositories, storage }, mapStorage] = await Promise.all([openRepositories(), openMapStorage()]);
  const serverSync = await openCampaignServerSync(repositories, mapStorage, storage);
  const editor = createCampaignEditor({
    confirm: question => window.confirm(question),
    gameSettings: editorGameSettings.getSnapshot,
    imageUrls: {
      create: (bytes, mimeType) =>
        URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType })),
      revoke: url => URL.revokeObjectURL(url)
    },
    mapFiles: mapStorage && { delete: mapStorage.delete, read: mapStorage.read },
    navigate: url => location.assign(url),
    now: Date.now,
    pageUrl: () => location.href,
    processImage: processCampaignImage,
    prompt: (question, value) => window.prompt(question, value),
    random: Math.random,
    repositories,
    serverSync,
    storage,
    translate: text => resolveEditorText(languagePreference.i18n, text)
  });
  const unmount = mountReactIsland(host, <CampaignEditorApp editor={editor} />);
  const { campaignId, mapId } = readCampaignSelection(location.search);
  await editor.start(campaignId, mapId);
  // The server's newer records arrive after the local list is on screen; nothing is said when nothing moved.
  void editor.syncWithServer(true);
  return () => {
    unmount();
    editor.dispose();
    mapStorage?.close();
  };
};

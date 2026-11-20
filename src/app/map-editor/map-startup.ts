import { MapFileError } from "../../shared/world/save/map-format";
import type { MapProvenance } from "../../shared/world/save/map-provenance";
import { type LoadedMap,readMapFile } from "../../shared/world/save/map-reader";
import { islandBuildRevisions } from "../island-build-keys";
import {
  formatIslandChoice,
  type IslandChoice,
  parseIslandChoice} from "../map-generator/helpers";
import type { EditorMap } from "./map-editor";
import { openMapStorage } from "./map-storage";
import { readWorldMap } from "./world-map-storage";

/** The map a `?map=` start loads, or why it could not (the island is generated instead). */
export interface StartMap {
  error: string;
  loaded: LoadedMap | null;
  /** The immutable shared-catalog revision this map was selected from. */
  provenance?: MapProvenance;
}

const NO_STORAGE = "The saved map could not be read: browser storage is not available.";
const MISSING = "The saved map is gone (deleted, or the browser data was cleared).";

const toMessage = (error: unknown) =>
  error instanceof MapFileError ? error.message : "The saved map could not be read.";

/** Reads the editor's shared World01.smap; never throws. */
export const readWorldMapStart = async (): Promise<StartMap | null> => {
  try {
    const bytes = await readWorldMap();
    if (!bytes) return null;
    const loaded = await readMapFile(bytes);
    return { error: "", loaded, provenance: loaded.meta.provenance };
  } catch (error) {
    return { error: toMessage(error), loaded: null };
  }
};

/** True when the slot holds a saved map file (a campaign map opened before its first save has none). */
export const hasSavedSlot = async (slotId: string) => {
  const storage = await openMapStorage();
  try {
    return Boolean(await storage?.read(slotId));
  } catch {
    return false;
  } finally {
    storage?.close();
  }
};

/** Reads and checks the saved map of the slot; never throws. */
export const readStartMap = async (slotId: string): Promise<StartMap> => {
  try {
    const storage = await openMapStorage();
    if (!storage) return { error: NO_STORAGE, loaded: null };
    const bytes = await storage.read(slotId);
    if (!bytes) return { error: MISSING, loaded: null };
    const loaded = await readMapFile(bytes);
    return { error: "", loaded, provenance: loaded.meta.provenance };
  } catch (error) {
    return { error: toMessage(error), loaded: null };
  }
};

/**
 * Cache group part of a loaded map: its slot, source and content, not the save time. A capture
 * that only advances `savedAt` reuses the same world and builds; edited terrain, props, build
 * state, fog or source produce a new key.
 */
export const toMapCacheKey = (slotId: string | null, loaded: LoadedMap | null) => {
  if (!loaded) return null;
  const { content } = islandBuildRevisions(loaded.world);
  return JSON.stringify({ content, slot: slotId, source: loaded.meta.source, version: 2 });
};

/** The island choice of the running map: a loaded map's own, else the URL's. */
export const getMapIslandChoice = (start: StartMap | null, fallback: IslandChoice) =>
  start?.loaded ? parseIslandChoice(start.loaded.meta.source) : fallback;

/** What the editor saves with the map (and the start's load error, if any). */
export const toEditorMap = (
  start: StartMap | null,
  choice: IslandChoice,
  seed: number
): EditorMap => ({
  animals: start?.loaded?.animals ?? [],
  contentCatalogVersion: start?.loaded?.meta.contentCatalogVersion,
  loadError: start?.error ?? "",
  name: start?.loaded?.meta.name ?? `Island ${seed}`,
  provenance: start?.provenance ?? start?.loaded?.meta.provenance,
  source: formatIslandChoice(choice),
  terrain: start?.loaded?.terrain ?? null
});

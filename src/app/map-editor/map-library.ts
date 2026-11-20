import { contentCatalogVersion } from "@shared/catalog";

import { validateMapScenario } from "../../shared/settlement/settlement-map-scenario";
import { MAX_AUTHORED_ANIMALS } from "../../shared/world/authored-animals";
import type { TerrainEditState } from "../../shared/world/editing/terrain/terrain-edit-state";
import { MapFileError, type PlacedAnimal } from "../../shared/world/save/map-format";
import type { MapProvenance } from "../../shared/world/save/map-provenance";
import { readMapFile } from "../../shared/world/save/map-reader";
import { writeMapFile } from "../../shared/world/save/map-writer";
import type { WorldData } from "../../shared/world/world-data";
import { adminAuthoredMapUrl } from "../admin-links";
import { createExternalStore } from "../components/ui-store";
import { TEST_PLAY_TAB } from "../script/test-play/constants";
import { testPlayUrl } from "../script/test-play/helpers";
import { reloadWithMap } from "../settings/graphics-settings";
import type { CampaignSlotRecord } from "./campaign/campaign-slot-record";
import { campaignEditorUrl, type CampaignMapSlot } from "./campaign/helpers";
import { formatFileSize } from "./helpers";
import {
  fetchStarterHistory,
  hashMapBytes,
  publishStarterMap,
  rollbackStarterMap,
  type StarterCatalog
} from "./map-catalog";
import { type MapSlot, type MapStorage,OPENED_FILE_SLOT, openMapStorage, TEST_PLAY_SLOT } from "./map-storage";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { writeWorldMap } from "./world-map-storage";

/** Saved maps kept in the browser. */
const MAX_MAP_SLOTS = 8;

export interface MapLibraryState {
  /** An action runs (save, read, load): the buttons wait. */
  busy: boolean;
  /** The campaign map slot this editor saves into (opened from the campaign editor), or null for World01. */
  campaignSlot: string | null;
  /** The shared starter's current revision and rollback history (null offline or before load). */
  catalog: StarterCatalog | null;
  catalogError: string;
  name: string;
  slots: MapSlot[];
  /** False when the browser gives no storage (files only). */
  storage: boolean;
}

export interface MapLibraryOptions {
  /** The campaign map record of `campaignSlot`: its name names the file; Save writes the hash and name back. */
  campaignRecord?: CampaignSlotRecord | null;
  /** Opened from the campaign editor: Save writes this slot, never World01; Play and Publish are refused. */
  campaignSlot?: CampaignMapSlot | null;
  /** The animals the editor placed (saved with the map). */
  getAnimals: () => readonly PlacedAnimal[];
  validateAnimals?: (animals: readonly PlacedAnimal[]) => readonly string[];
  /** The editor's mountain and lake stamps, with every waiting click applied (saved too). */
  getTerrain: () => TerrainEditState | null;
  /** In-page load; false resumes the editor, absent keeps the committed reload path. */
  loadMap?: (slotId: string) => boolean | Promise<boolean>;
  /** The map's name at the start (a loaded map's, else a default). */
  name: string;
  /** Shows a message in the editor's hint line (warning tone for errors). */
  notify: (text: EditorText, isError?: boolean) => void;
  /** Exact published catalog revision the draft came from, when it has one. */
  provenance?: MapProvenance;
  /** How the island was first generated (kept in the file). */
  source: string;
  world: WorldData;
}

const DEFAULT_NAME = "Island";
const NO_STORAGE = M.library.loadNeedsStorage;
const SLOTS_FULL = M.library.slotsFull;

const toErrorText = (error: unknown): EditorText =>
  error instanceof MapFileError ? error.message : M.library.browserRefused;

const createSlotId = () => `map-${Date.now().toString(36)}`;

/**
 * Saving and loading maps (logic of the panel's Map section): a download or an `.island` file,
 * and a few named slots in the browser (IndexedDB). Loading reloads the page with `?map=`, so
 * the loaded world goes through the same start as a generated one (renderer, minimap,
 * build overlay, animals, critters, workers).
 */
export const createMapLibrary = (options: MapLibraryOptions) => {
  const { notify, world } = options;
  const campaignSlot = options.campaignSlot ?? null;
  const store = createExternalStore<MapLibraryState>({ busy: false, campaignSlot: campaignSlot?.slotId ?? null,
    catalog: null, catalogError: "", name: options.name, slots: [], storage: true });
  const getState = store.getSnapshot;
  let storage: MapStorage | null = null;
  let disposed = false;
  const update = (change: Partial<MapLibraryState>) => store.set({ ...getState(), ...change });

  const getName = () => getState().name.trim() || DEFAULT_NAME;

  const writeFile = () =>
    writeMapFile(world, {
      animals: options.getAnimals(),
      contentCatalogVersion: contentCatalogVersion(),
      name: getName(),
      provenance: options.provenance,
      savedAt: Date.now(),
      source: options.source,
      terrain: options.getTerrain()
    });

  /** Runs an action with the buttons waiting; errors become a message. */
  const run = async (action: () => Promise<void>) => {
    if (disposed || getState().busy) return;
    update({ busy: true });
    try {
      await action();
    } catch (error) {
      notify(toErrorText(error), true);
    } finally {
      update({ busy: false });
    }
  };

  const refreshSlots = async () => {
    if (storage) update({ slots: await storage.list() });
  };

  /** Fetch the immutable starter history; standalone/offline editors simply have no catalog. */
  const refreshCatalog = async () => {
    try {
      const catalog = await fetchStarterHistory();
      if (!disposed) update({ catalog, catalogError: "" });
    } catch (error) {
      if (!disposed) update({ catalog: null,
        catalogError: error instanceof Error ? error.message : "The shared map history is unavailable." });
    }
  };

  /** The revision the editor last displayed, used for publish/rollback guards. */
  const currentStarter = async () => {
    if (!getState().catalog) await refreshCatalog();
    return getState().catalog?.current ?? null;
  };
  const currentHash = async () => (await currentStarter())?.hash ?? null;

  let saveGuard = () => true;

  const storeSlot = async (id: string, saved = M.library.saved) => {
    if (!storage) return;
    const bytes = await writeFile();
    const name = getName();
    await storage.write({ id, name, savedAt: Date.now(), size: bytes.length }, bytes);
    if (id === campaignSlot?.slotId) await options.campaignRecord?.recordSave(await hashMapBytes(bytes), name);
    await refreshSlots();
    notify(editorMessage(saved, { name, size: formatFileSize(bytes.length) }));
  };

  /** A campaign map file is named after its campaign map (not the starter's "Island 1234"). */
  const adoptCampaignMapName = async () => {
    const name = await options.campaignRecord?.mapName();
    if (name && !disposed) update({ name });
  };

  /** A campaign map never replaces World01 or the shared starter (plan item 41). */
  const refusedForCampaign = () => {
    if (!campaignSlot) return false;
    notify(M.library.campaignMapOnly, true);
    return true;
  };

  /** False (with the errors as a message) while the scenario or its animals cannot be played. */
  const isPlayable = () => {
    const errors = [...validateMapScenario(options.world), ...(options.validateAnimals?.(options.getAnimals()) ?? [])];
    if (errors.length) notify(editorMessage(M.scenario.errors, { errors: errors.join("; ") }), true);
    return errors.length === 0;
  };

  const writeTestPlayMap = async () => {
    const bytes = await writeFile();
    await storage?.write({ id: TEST_PLAY_SLOT, name: getName(), savedAt: Date.now(), size: bytes.length }, bytes);
  };

  /** In-page when the runtime supplies a handoff, else the durable `?map=` reload. */
  const load = async (slotId: string) => {
    if (!options.loadMap) {
      reloadWithMap(slotId);
      return;
    }
    if (!await options.loadMap(slotId)) notify(M.library.loadFailed, true);
  };

  const connect = async () => {
    if (disposed) return;
    const opened = await openMapStorage();
    if (disposed) { opened?.close(); return; }
    storage = opened;
    update({ storage: storage !== null });
    await Promise.all([refreshSlots().catch(() => update({ storage: false })), refreshCatalog(),
      adoptCampaignMapName().catch(() => undefined)]);
  };
  void connect();

  return {
    dispose: () => {
      disposed = true;
      storage?.close();
      storage = null;
    },
    /** Back to the campaign editor on the campaign and map this editor was opened from. */
    backToCampaign: () => {
      if (campaignSlot) location.assign(campaignEditorUrl(location.href, campaignSlot.campaignId, campaignSlot.mapId));
    },
    /** Play the authored map fresh in the administrator game page, bypassing the saved home island. */
    play: () => run(async () => {
      if (refusedForCampaign() || !isPlayable()) return;
      await writeWorldMap(await writeFile());
      location.assign(adminAuthoredMapUrl(location.href));
    }),
    /**
     * Admin play-test (Script window): the edited map with its script goes into the play-test slot and the game
     * opens on it in the play-test tab. World01, the campaign slot, the shared starter and every save stay
     * untouched, so campaign maps may be tested too; the editor stays open.
     */
    testPlay: () => {
      if (!storage) { notify(M.library.blocked, true); return; }
      if (disposed || getState().busy || !isPlayable()) return;
      // Opened inside the click, before the asynchronous write, so the browser does not block the new tab.
      const tab = window.open("", TEST_PLAY_TAB);
      void run(async () => {
        try {
          await writeTestPlayMap();
        } catch (error) {
          tab?.close();
          throw error;
        }
        const url = testPlayUrl(location.href);
        if (tab) tab.location.href = url;
        else location.assign(url);
      });
    },
    /** Publish the authored world once; the API stores an immutable revision and moves the pointer. */
    publishStarter: () => run(async () => {
      if (refusedForCampaign() || !isPlayable()) return;
      const start = options.world.scenario?.headquarters ?? options.world.start;
      const cell = Math.floor(start.z) * options.world.cellsX + Math.floor(start.x);
      if (start.x < 0 || start.z < 0 || start.x >= options.world.cellsX || start.z >= options.world.cellsZ ||
        !options.world.walkCost[cell] || options.world.blocking[cell]) {
        notify(M.library.publishNoHeadquarters, true);
        return;
      }
      try {
        const current = await currentStarter();
        const published = await publishStarterMap(await writeFile(), current?.hash ?? null, current?.mapId);
        await refreshCatalog();
        notify(editorMessage(M.library.published, { revision: String(published.revision) }));
      } catch (error) {
        notify(error instanceof Error ? error.message : M.library.publishFailed, true);
      }
    }),
    /** Restores the shared starter pointer to any retained revision (no bytes are rewritten). */
    rollbackStarter: (mapId: string, revision: number) =>
      run(async () => {
        try {
          await rollbackStarterMap(mapId, revision, await currentHash());
          await refreshCatalog();
          notify(editorMessage(M.library.rolledBack, { revision: String(revision) }));
        } catch (error) {
          notify(error instanceof Error ? error.message : M.library.catalogFailed, true);
        }
      }),
    refreshCatalog,
    /** The declared exits of the campaign map this editor was opened for; null without a campaign record. */
    campaignExits: async () => (await options.campaignRecord?.exits()) ?? null,
    deleteSlot: (id: string) =>
      run(async () => {
        await storage?.delete(id);
        await refreshSlots();
      }),
    getState,
    /** Checks the file, keeps it for the reload and loads it. */
    loadFile: (file: File) =>
      run(async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { meta } = await readMapFile(bytes);
        if (!storage) {
          notify(NO_STORAGE, true);
          return;
        }
        const { name, savedAt } = meta;
        await storage.write({ id: OPENED_FILE_SLOT, name, savedAt, size: bytes.length }, bytes);
        await load(OPENED_FILE_SLOT);
      }),
    loadSlot: (id: string) => run(() => load(id)),
    overwriteSlot: (id: string) => {
      if (saveGuard()) run(() => storeSlot(id));
    },
    /** Saves the authoritative home map the game loads, or the campaign map's own slot when opened from one. */
    saveFile: () =>
      saveGuard() && run(async () => {
        if (campaignSlot && !storage) { notify(M.library.blocked, true); return; }
        if (campaignSlot) { await storeSlot(campaignSlot.slotId, M.library.campaignSaved); return; }
        const bytes = await writeFile();
        await writeWorldMap(bytes);
        notify(editorMessage(M.library.worldSaved, { size: formatFileSize(bytes.length) }));
      }),
    saveNewSlot: () =>
      saveGuard() && run(async () => {
        if (getState().slots.length >= MAX_MAP_SLOTS) {
          notify(SLOTS_FULL, true);
          return;
        }
        await storeSlot(createSlotId());
      }),
    setName: (name: string) => update({ name }),
    /** Asks before a save (the map script's "save as draft anyway?", TRG11); true lets the save run. */
    setSaveGuard: (guard: () => boolean) => { saveGuard = guard; },
    /** Calls the listener after every change; returns its unsubscribe. */
    subscribe: store.subscribe
  };
};

export type MapLibrary = ReturnType<typeof createMapLibrary>;

/**
 * The animals the editor placed (map content, saved with the map): starts with a loaded map's
 * and records every successful placement.
 */
export const recordPlacedAnimals = (
  loaded: readonly PlacedAnimal[],
  manager: {
    placeAnimal: (species: number, x: number, z: number, age?: number) => boolean;
    restoreAnimal?: (species: number, x: number, z: number, age?: number) => boolean;
    removeAnimal: (species: number, x: number, z: number) => boolean;
  }
) => {
  const placed = [...loaded];
  return {
    list: (): readonly PlacedAnimal[] => placed,
    place: (species: number, x: number, z: number, age?: number) => {
      if (placed.length >= MAX_AUTHORED_ANIMALS || !manager.placeAnimal(species, x, z, age)) return false;
      placed.push({ species, x, z, ...(age === undefined ? {} : { age }) });
      return true;
    },
    restore: (animal: PlacedAnimal) => {
      const restore = manager.restoreAnimal ?? manager.placeAnimal;
      if (placed.length >= MAX_AUTHORED_ANIMALS || !restore(animal.species, animal.x, animal.z, animal.age))
        throw new Error("Cannot restore this authored animal: its ground or habitat is no longer suitable");
      placed.push({ ...animal });
    },
    /** Takes a placed animal away again (map editor undo). */
    remove: ({ species, x, z }: PlacedAnimal) => {
      const index = placed.findLastIndex(
        (animal) => animal.species === species && animal.x === x && animal.z === z
      );
      if (index >= 0) placed.splice(index, 1);
      manager.removeAnimal(species, x, z);
    }
  };
};

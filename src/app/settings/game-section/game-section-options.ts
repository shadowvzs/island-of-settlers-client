import type { I18n } from "@lingui/core";

import type { GameSettings } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { PlayerAccount } from "../../account/account-boot";
import type { CloudSession } from "../../cloud/cloud-boot";
import {
  type BrowserBackend, browserSaving, browserWorkingSlot, continueGameUrl, hasTitlePage, titlePageUrl
} from "../../game-settings/session-mode";
import type { OfflineCloud } from "../../save-slots/offline-cloud";
import { createSaveSlotsWindow } from "../../save-slots/save-slots-window";
import { createInGameSlots } from "../../save-slots/slot-actions";
import { openSlotRepository, type SlotRepository, type SlotStores } from "../../save-slots/slot-repository";
import type { SaveCoordinator } from "../../save-store/save-coordinator";
import { createExitGame } from "./exit-game";
import type { GameSectionOptions } from "./game-section";

export interface GameSectionWiring {
  /** The signed-in account (a cloud slot's copies and offline server saves are stored under it). */
  account: PlayerAccount | null;
  backend: BrowserBackend;
  cloud: CloudSession | null;
  /** The window layer's container (the viewport). */
  container: HTMLElement;
  i18n: I18n;
  /** A signed-in offline player's server saves (OFFLINE-CLOUD); null keeps the slots in this browser. */
  offlineCloud: OfflineCloud | null;
  /** The map's name for a new slot's meta, when the game knows it. */
  place?: () => string | undefined;
  saving: SaveCoordinator | null;
  settings: GameSettings | null;
}

/** The working slot's repository, opened on first use (the window and IndexedDB stay out of startup). */
const deferredRepository = (workingSlotId: string, stores: SlotStores): SlotRepository => {
  let opened: Promise<SlotRepository> | undefined;
  const open = () => opened ??= openSlotRepository(workingSlotId, stores);
  return {
    discardWorking: async () => (await open()).discardWorking(),
    list: async () => (await open()).list(),
    loadIntoWorking: async number => (await open()).loadIntoWorking(number),
    newGame: async () => (await open()).newGame(),
    remove: async number => (await open()).remove(number),
    saveFromWorking: async (number, input) => (await open()).saveFromWorking(number, input),
    workingSlotId
  };
};

/** A signed-in cloud slot keeps copies on the server; a signed-in offline player its offline saves. */
const slotStoresOf = ({ account, cloud, offlineCloud }: GameSectionWiring): SlotStores => ({
  cloud: account && cloud ? { account, cloud } : null, offline: offlineCloud
});

/** Save/Load in game when this session keeps browser slots (plan §5.6, §7.3), with the window it opens. */
const createSlotsSection = (wiring: GameSectionWiring, saving: SaveCoordinator) => {
  const { autosave, slots } = browserSaving(wiring.settings, wiring.backend, Boolean(wiring.cloud));
  if (!slots) return null;
  const inGame = createInGameSlots({
    continueGame: () => location.assign(continueGameUrl(location.href)),
    exitToTitle: () => location.assign(titlePageUrl(location.href)),
    place: wiring.place, repository: deferredRepository(browserWorkingSlot(wiring.settings), slotStoresOf(wiring)), saving
  });
  const window = createSaveSlotsWindow(wiring.container, inGame.controls, wiring.i18n);
  return {
    dispose: window.dispose,
    slots: { leaveWithoutSaving: inGame.leaveWithoutSaving, manualSaving: !autosave, open: window.open }
  };
};

/**
 * Settings > Misc > Game wherever a title page exists (GS3b, SAVE-SLOTS; never in tool runs): Exit game, plus Save
 * and Load when the session keeps slots. Undefined elsewhere.
 */
export const createGameSectionOptions = (wiring: GameSectionWiring) => {
  if (!hasTitlePage(wiring.settings)) return undefined;
  const { cloud, saving } = wiring;
  const slots = saving ? createSlotsSection(wiring, saving) : null;
  const options: GameSectionOptions = { exitGame: createExitGame({ cloud, saving }),
    ...(slots ? { slots: slots.slots } : {}) };
  return { dispose: () => slots?.dispose(), options };
};

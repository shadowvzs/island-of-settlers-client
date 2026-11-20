import type { I18n } from "@lingui/core";
import { SOURCE_VERSION } from "virtual:source-version";

import { translateMessage } from "../../shared/i18n/translate";
import type { PlayerAccount } from "../account/account-boot";
import type { AccountScroll } from "../account/account-scroll";
import { createExternalStore } from "../components/ui-store";
import { rawTextCodec } from "../preferences/codecs";
import { PREFERENCES } from "../preferences/keys";
import { definePreference } from "../preferences/registry";
import { createLocalSaveStore } from "../save-store/local-save-store";
import type { CloudSaveStatus } from "../save-store/remote-save-store";
import { createRemoteSaveStore } from "../save-store/remote-save-store";
import {
  createSaveApiClient, type SaveApiClient, type SaveSlot, type ServerFull
} from "../save-store/save-api-client";
import { recoverySlotId } from "../save-store/save-retention";
import type { GameDatabase } from "../settlement/game-database";
import { createCommanderRecoveryClient, createCommanderRecoveryTransport } from "./commander-recovery-client";
import { createEconomyClient } from "./economy-client";
import {
  describeSlot, getCloudFailedLead, getRestoreLead, getServerFullLead, getSlotsLead, QUEUE_RETRY_MS, SLOT_NUMBERS
} from "./helpers";
import { CLOUD_MESSAGES } from "./messages";
import { createRoadDecorationClient, createRoadDecorationTransport } from "./road-decoration-client";
import { createServerEconomy } from "./server-economy";
import { createServerMarket } from "./server-market";
import { createSessionClock } from "./session-clock";
import { createLeaseKeeper } from "./session-lease";
import { createStockMoveClient } from "./stock-move";
import { createVerificationStatus } from "./verification-status";

/** The tab's cloud slot: island travel and other reloads continue it without asking again. */
const tabSlot = definePreference(PREFERENCES.cloudSlot, rawTextCodec);
/**
 * Set when this tab leaves the page while playing a slot: its last save (written locally as the tab closed or
 * reloaded) continues on the next load of the same tab without asking.
 */
const tabHandoff = definePreference(PREFERENCES.cloudHandoff, rawTextCodec);

interface CloudStartOptions {
  database: GameDatabase;
  /** Active interface language; absent keeps the English source copy (tests and tool runs). */
  i18n?: I18n;
  /** Opens the start scroll (on demand: a reload into the same slot shows nothing). */
  openScroll: () => AccountScroll;
  player: PlayerAccount;
  /** Per tab (guarded sessionStorage): survives reloads, not a new tab. */
  tabStorage: Pick<Storage, "getItem" | "removeItem" | "setItem">;
}

const askSlot = (scroll: AccountScroll, api: SaveApiClient, player: PlayerAccount, slots: readonly SaveSlot[],
  i18n?: I18n) =>
  new Promise<SaveSlot>(resolve => scroll.show({
    choices: SLOT_NUMBERS.map(slotNo => {
      const slot = slots.find(entry => entry.slot_no === slotNo);
      return { label: describeSlot(slotNo, slot, i18n), onSelect: async () => {
        if (slot) { resolve(slot); return; }
        const created = await api.createSlot(slotNo,
          translateMessage(i18n, CLOUD_MESSAGES.slotDefaultName, { slotNo }));
        if (!created.ok) throw new Error(translateMessage(i18n, CLOUD_MESSAGES.messages.slotCreatedElsewhere));
        resolve(created.slot);
      } };
    }),
    kind: "choices", lead: getSlotsLead(player.account.displayName, i18n),
    title: translateMessage(i18n, CLOUD_MESSAGES.slotsTitle)
  }));

/** The tab's slot when it still exists, else the player's choice (creating an empty slot when picked). */
const chooseSlot = async (api: SaveApiClient, options: CloudStartOptions) => {
  const slots = await api.listSlots(), remembered = tabSlot.read(options.tabStorage);
  const slot = slots.find(entry => entry.id === remembered) ??
    (await askSlot(options.openScroll(), api, options.player, slots, options.i18n));
  tabSlot.write(slot.id, options.tabStorage);
  return slot;
};

const askYesNo = (scroll: AccountScroll, title: string, lead: string, yes: string, no: string) =>
  new Promise<boolean>(resolve => scroll.show({ choices: [
    { label: yes, onSelect: () => resolve(true) }, { label: no, onSelect: () => resolve(false) }
  ], kind: "choices", lead, title }));

/** The online save could not be opened (the service went away after the probe): try again or play as guest. */
export const askCloudRetry = (scroll: AccountScroll, reason: string, i18n?: I18n) => askYesNo(scroll,
  translateMessage(i18n, CLOUD_MESSAGES.cloudFailedTitle), getCloudFailedLead(reason, i18n),
  translateMessage(i18n, CLOUD_MESSAGES.actions.tryAgain),
  translateMessage(i18n, CLOUD_MESSAGES.actions.playAsGuest));

type LeaseKeeper = ReturnType<typeof createLeaseKeeper>;
type QueueAnswer = "guest" | "retry";

/** The server is full: the queue place, a retry after QUEUE_RETRY_MS, or guest play when the player asks. */
const waitInQueue = (scroll: AccountScroll, full: ServerFull, i18n?: I18n) =>
  new Promise<QueueAnswer>(resolve => {
    const timer = setTimeout(() => resolve("retry"), QUEUE_RETRY_MS);
    scroll.show({
      choices: [{
        label: translateMessage(i18n, CLOUD_MESSAGES.actions.keepPlayingOffline),
        onSelect: () => {
          clearTimeout(timer);
          resolve("guest");
        }
      }],
      kind: "choices", lead: getServerFullLead(full, i18n),
      note: translateMessage(i18n, CLOUD_MESSAGES.queueNote),
      title: translateMessage(i18n, CLOUD_MESSAGES.serverFullTitle)
    });
  });

/**
 * The account's live session on this device: taking it over from another device when the player agrees, and
 * waiting in the server's queue while it is full. False for guest play.
 */
const takeSeat = async (lease: LeaseKeeper, openScroll: () => AccountScroll, i18n?: I18n) => {
  let takeOver = false;
  for (;;) {
    const result = await lease.acquire(takeOver);
    if (result === "acquired") return true;
    if (result === "held") {
      if (!(await askYesNo(openScroll(), translateMessage(i18n, CLOUD_MESSAGES.takeOverTitle),
        translateMessage(i18n, CLOUD_MESSAGES.takeOverLead),
        translateMessage(i18n, CLOUD_MESSAGES.actions.takeOverHere),
        translateMessage(i18n, CLOUD_MESSAGES.actions.playAsGuestInstead)))) return false;
      takeOver = true;
    } else if (await waitInQueue(openScroll(), result, i18n) === "guest") return false;
  }
};

/** The login's offline catch-up runs on the server (D4.4); null keeps the client's own catch-up as the fallback. */
const catchUpOnServer = (store: ReturnType<typeof createRemoteSaveStore>) => store.catchUp(SOURCE_VERSION);

/**
 * After sign-in: the save slot (remembered per tab), the account's single live session (taking it over when
 * the player agrees) and the game to start from: the slot's snapshot, or this browser's unsent copy when it is
 * newer and the player keeps it. Null when the player declines to take the session over (guest play).
 */
export const startCloudSession = async (options: CloudStartOptions) => {
  const { i18n } = options;
  const { identity } = options.player;
  const access = { apiUrl: options.player.backend.apiUrl, getAccessToken: identity.accessToken,
    renewAccessToken: identity.renew };
  const api = createSaveApiClient(access);
  const slot = await chooseSlot(api, options);
  const status = createExternalStore<CloudSaveStatus | null>(null);
  const lost = createExternalStore(false);
  const lease = createLeaseKeeper({ api, onLost: () => lost.set(true) });
  if (!(await takeSeat(lease, options.openScroll, i18n))) return null;
  const economyClient = createEconomyClient({ ...access, leaseId: lease.id });
  const local = createLocalSaveStore(options.database, recoverySlotId(options.player.account.id, slot.id));
  const store = createRemoteSaveStore({ api, leaseId: lease.id, local, onStatus: status.set, slotId: slot.id });
  const stock = createStockMoveClient({ client: economyClient, onLeaseLost: () => lost.set(true), slotId: slot.id,
    store });
  /** The Player Market's combined flow; its pending operation keys survive a same-tab reload. */
  const market = createServerMarket({ accountId: options.player.account.id, client: economyClient, scope: slot.id,
    stock, storage: options.tabStorage });
  /** The slot's verified revision and flag: shown beside the save line and used to re-claim verified levels. */
  const verification = createVerificationStatus({ api, revision: store.revision, slotId: slot.id });
  let [server, unsent, wallet] = await Promise.all([store.readSavedGame(), local.readSavedGame(),
    economyClient.wallet()]);
  const recovery=createCommanderRecoveryClient({ accountId:options.player.account.id,slotId:slot.id,
    storage:options.tabStorage,revision:store.revision,adopt:store.adoptServerMutation,
    transport:createCommanderRecoveryTransport({ ...access,leaseId:lease.id }) });
  const recovered=await recovery.reconcile();
  const roadDecorations = createRoadDecorationClient({ accountId: options.player.account.id, slotId: slot.id,
    storage: options.tabStorage, revision: store.revision, adopt: store.adoptServerMutation,
    transport: createRoadDecorationTransport({ ...access, leaseId: lease.id }) });
  const decorated = await roadDecorations.reconcile();
  if (recovered.confirmed || decorated.confirmed) {
    // A paid world mutation wins its unacknowledged old local branch before any restore choice.
    await local.clearSavedGame();
    server=await store.readSavedGame();
    wallet=await economyClient.wallet();
    unsent=null;
  }
  const handoff = tabHandoff.read(options.tabStorage) === slot.id;
  tabHandoff.clear(options.tabStorage);
  let initialGame = server, restored = false;
  if (unsent && unsent.savedAt > (server?.savedAt ?? 0)) {
    restored = handoff || await askYesNo(options.openScroll(),
      translateMessage(i18n, CLOUD_MESSAGES.restoreTitle),
      getRestoreLead(unsent.savedAt, server?.savedAt ?? null, i18n),
      translateMessage(i18n, CLOUD_MESSAGES.actions.continueLocal),
      translateMessage(i18n, CLOUD_MESSAGES.actions.loadOnline));
    if (restored) { initialGame = unsent; store.startUnverified(); }
    else await local.clearSavedGame();
  }
  const caughtUp = restored || !server ? null : await catchUpOnServer(store);
  if (caughtUp?.game) initialGame = caughtUp.game;
  let exited = false;
  return {
    /** The signed-in account this slot belongs to (a retained resume must not cross accounts). */
    accountId: options.player.account.id,
    /** Real UTC time anchored at the server's time when the session started (the game clock's anchor). */
    clock: createSessionClock(lease.serverTime()),
    /** The server's gems, rewards and purchases for the player session (phase B). */
    economy: createServerEconomy({ client: economyClient, pendingStorage: options.tabStorage,
      scope: options.player.account.id, slotId: slot.id, startGems: wallet.gems, startInventory: wallet.items,
      startNation: wallet.chosenNation }),
    /** The server already replayed the time away (its save time and summary): the client must not again. */
    caughtUp: caughtUp && initialGame ? { savedAt: initialGame.savedAt, summary: caughtUp.summary } : null,
    debug: { clearSaves: () => api.clearDebugSaves(), recreateDatabase: () => api.recreateDebugDatabase() },
    initialGame, lease, lost, market, recovery, roadDecorations, slot, status, stock, store, verification,
    /** The game starts from the unsent local copy: it should upload soon. */
    restored,
    /** The tab leaves the page (reload, close): its local last save continues this tab without asking. */
    markHandoff: () => { if (!exited) tabHandoff.write(slot.id, options.tabStorage); },
    /** Account or slot exit: a later pagehide must not mark a handoff for the forgotten slot. */
    markExited: () => { exited = true; },
    /** Load the newer save: this browser's unsent copy is dropped. */
    discardUnsent: () => local.clearSavedGame(),
    /** Logging out: the tab forgets its slot. */
    forgetSlot: () => tabSlot.clear(options.tabStorage)
  };
};

export type CloudSession = NonNullable<Awaited<ReturnType<typeof startCloudSession>>>;

/** The startup's view of the slot: the game chosen at sign-in instead of a second snapshot download. */
export const cloudStartupStore = (cloud: CloudSession) => ({ ...cloud.store, readSavedGame: async () => cloud.initialGame });

/** Logging out: the tab forgets its slot and the session lease ends. */
export const endCloudSession = async (cloud: CloudSession) => {
  cloud.markExited();
  cloud.forgetSlot();
  cloud.verification.stop();
  cloud.store.stop();
  await cloud.lease.release();
};

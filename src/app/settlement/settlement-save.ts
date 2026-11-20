import type { I18n } from "@lingui/core";

import { isLocalRulesRevision } from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import { translateMessage } from "../../shared/i18n/translate";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { downloadJson, errorMessage } from "../helpers";
import type { CapturedGame } from "../save-store/captured-game";
import type { SaveStore } from "../save-store/save-store";
import { SESSION_MESSAGES } from "../session-messages";

export interface SettlementSaveOptions {
  /** The running game's inputs, gathered synchronously (the save's tick-boundary capture). */
  captureGame(): CapturedGame;
  /** The running game as a save document (Export game). */
  captureSession(): Promise<GameSaveV1>;
  /** Must stage and validate the new world/simulation before replacing the current session. */
  restoreSession(value: unknown): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Import game replaces the current game only after the player agrees. */
  confirmImport(): Promise<boolean>;
  /** Active interface language; absent keeps the English source copy (tests and non-UI callers). */
  i18n?: I18n;
  notify(message: string): void;
  store: Pick<SaveStore, "location" | "writeCapturedGame">;
}

const SAVED_NOTICES = {
  account: SESSION_MESSAGES.save.savedAccount,
  browser: SESSION_MESSAGES.save.savedBrowser
} as const;
const IMPORT_MESSAGES = {
  account: SESSION_MESSAGES.save.importAccount,
  browser: SESSION_MESSAGES.save.importBrowser
} as const;

/** The Import game question (the caller shows it with Replace and Cancel). */
export const getImportQuestion = (location: SaveStore["location"], i18n?: I18n) => ({
  message: translateMessage(i18n, IMPORT_MESSAGES[location]),
  title: translateMessage(i18n, SESSION_MESSAGES.save.importTitle)
});

/** Reads a chosen game file; null (with the reason shown) when it is not JSON. */
const readGameFile = async (file: File, notify: (message: string) => void, i18n?: I18n): Promise<unknown> => {
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    notify(translateMessage(i18n, SESSION_MESSAGES.save.notGameFile));
    return null;
  }
};

/**
 * An offline game never becomes an account's save (plan §12, GS3a): a file saved by an offline slot, or whose island
 * is pinned to offline (`local:`) rules, is refused before the Import question. Browser imports stay allowed.
 */
export const isOfflineGameFile = (value: unknown) => {
  if (!isPlainObject(value)) return false;
  if (value.origin === "offline") return true;
  const settlement = value.settlement;
  if (!isPlainObject(settlement) || !isPlainObject(settlement.gameRules)) return false;
  const revision = settlement.gameRules.revision;
  return typeof revision === "string" && isLocalRulesRevision(revision);
};

/** A file picker for one game file. */
const pickGameFile = (onFile: (file: File) => void) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  }, { once: true });
  input.click();
};

/** Storage and file actions share the exact same versioned JSON representation. */
export const createSettlementSaveController = (options: SettlementSaveOptions) => {
  const { i18n, store } = options;
  const t = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  /** The running save / load / export (one at a time); later callers can wait for it. */
  let inFlight: Promise<boolean> | null = null;
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      return true;
    } catch (error) {
      options.notify(errorMessage(error, t(SESSION_MESSAGES.save.accessFailed)));
      return false;
    }
  };
  const perform = (action: () => Promise<void>) => {
    if (inFlight) return Promise.resolve(false);
    const current = run(action).finally(() => { inFlight = null; });
    inFlight = current;
    return current;
  };
  /** Resolves once no action runs (the finished action's result does not matter). */
  const whenIdle = async () => {
    while (inFlight) await inFlight;
  };
  const loadValue = async (value: unknown) => {
    const result = await options.restoreSession(value);
    if (!result.ok) throw new Error(result.reason);
    options.notify(t(SESSION_MESSAGES.save.loaded));
  };
  /** Saves the game where its store keeps it; `null` keeps a background save silent. */
  const save = (notice: string | null = t(SAVED_NOTICES[store.location])) =>
    perform(async () => {
      await store.writeCapturedGame(options.captureGame());
      if (notice !== null) options.notify(notice);
    });
  /**
   * Waits for a running save (e.g. an autosave) to finish, then saves the current game: Log out and Export
   * account never fail because another save was running.
   */
  const saveWhenIdle = async (notice?: string | null) => {
    for (;;) {
      await whenIdle();
      if (!inFlight) return save(notice);
    }
  };
  const importChosen = async (file: File) => {
    const value = await readGameFile(file, options.notify, i18n);
    if (value === null) return;
    if (store.location === "account" && isOfflineGameFile(value)) {
      options.notify(t(SESSION_MESSAGES.save.offlineImportRefused));
      return;
    }
    if (!(await options.confirmImport())) return;
    await perform(() => loadValue(value));
  };
  return {
    isBusy: () => inFlight !== null,
    save,
    saveWhenIdle,
    whenIdle,
    exportFile: () =>
      perform(async () => {
        const saved = await options.captureSession();
        downloadJson(saved, `island-settlers-${new Date(saved.savedAt).toISOString().slice(0, 10)}.json`);
        options.notify(t(SESSION_MESSAGES.save.exported));
      }),
    /** Import game: a game file replaces the current game once the player confirms (signed in: the slot's save). */
    importFile: () => {
      if (inFlight) return;
      pickGameFile(file => void importChosen(file));
    },
    importJson: (text: string) => perform(() => loadValue(JSON.parse(text)))
  };
};

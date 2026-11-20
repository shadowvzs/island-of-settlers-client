import type { I18n } from "@lingui/core";

import { downloadJson } from "../helpers";
import {
  exportLocalAccounts, markLocalAccountExportOffered, runStartupRetention
} from "../save-store/save-retention";
import { openGameDatabase } from "../settlement/game-database";
import { createScrollHost } from "./account-boot";
import { offerLocalAccountExport } from "./account-scroll";

interface BrowserRetentionOptions {
  container: HTMLElement;
  /** Active interface language; absent keeps the English source copy (tests and tool runs). */
  i18n?: I18n;
  /** Tool runs sweep silently: no offer opens over an automated page. */
  offer: boolean;
  setRegistering: (registering: boolean) => void;
}

const logRetention = (message: string) => console.info(`[retention] ${message}`);

/**
 * Startup retention of this browser's saves (save-retention.ts); the first startup that finds old local
 * accounts offers their saves for export once, on the scroll.
 */
export const runBrowserRetention = async ({ container, i18n, offer, setRegistering }: BrowserRetentionOptions) => {
  const database = await openGameDatabase();
  const plan = await runStartupRetention(database, Date.now(), logRetention);
  if (plan.kind !== "offer" || !offer) return;
  const host = createScrollHost({ container, i18n, setRegistering });
  await offerLocalAccountExport(host.open(), {
    exportSaves: async () => { await exportLocalAccounts(database, plan.accounts, downloadJson); },
    removeAfter: plan.removeAfter,
    usernames: plan.accounts.map(account => account.username)
  });
  await markLocalAccountExportOffered(database);
  host.close();
};

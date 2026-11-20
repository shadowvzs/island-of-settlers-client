import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Browser } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Real IndexedDB migrations, each in a fresh profile:
 * 1. a single-document save (before tables) becomes the guest slot's rows and reads back unchanged;
 * 2. a version 3 database (one game tagged with its account) upgrades to version 4: the game moves into that
 *    account's slot, the account row and the pending startup payload survive;
 * 3. removing one of two old local accounts deletes exactly its rows.
 * Run: npx tsx tools/bench/game-database-review.ts
 */
const saved = readFileSync("/home/shadowvzs/Downloads/island-settlers-2026-10-11.json", "utf8");
const SAVE_KEY = "island-settlers.saved-game.v1";

/** Every table's keys (and the boot values) of the game database. */
const readTables = () => new Promise<Record<string, unknown[]>>(resolve => {
  const open = indexedDB.open("island-settlers-db");
  open.onsuccess = () => {
    const database = open.result, names = [...database.objectStoreNames], out: Record<string, unknown[]> = {};
    const read = database.transaction(names);
    for (const name of names) read.objectStore(name).getAllKeys().onsuccess = event =>
      { out[name] = (event.target as IDBRequest).result; };
    read.oncomplete = () => { database.close(); resolve(out); };
  };
});

const openFixturePage = async (browser: Browser, url: string) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/db-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}db-fixture.html`);
  return page;
};

const reviewSingleDocument = async (browser: Browser, url: string) => {
  const page = await openFixturePage(browser, url);
  const result = await page.evaluate(async ([text, key, tablesSource]) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("island-settlers-games", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("games");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const write = open.result.transaction("games", "readwrite");
        write.objectStore("games").put(text, key);
        write.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const migrated = (await (await openLocalSaveStore()).readSavedGame())!;
    const original = JSON.parse(text);
    return { sameMap: migrated.map === original.map, sameSettlement:
      JSON.stringify(migrated.settlement) === JSON.stringify(original.settlement),
    // oxlint-disable-next-line eslint/no-eval -- dev review evaluates its table reader source in the page
    tables: await (0, eval)(tablesSource)() as Record<string, unknown[]> };
  }, [saved, SAVE_KEY, `(${readTables.toString()})`] as const);
  assert.equal(result.sameMap, true);
  assert.equal(result.sameSettlement, true);
  assert.deepEqual(result.tables.islands, [["guest", "home"]]);
  assert.deepEqual(result.tables.sessions, ["guest"]);
  console.log("single document -> guest slot", JSON.stringify(result.tables));
  await page.context().close();
};

/** Builds the version 3 tables (single slot) with one tagged game, then opens the current version. */
const reviewVersion3Upgrade = async (browser: Browser, url: string) => {
  const page = await openFixturePage(browser, url);
  const result = await page.evaluate(async ([text, tablesSource]) => {
    const { splitGameSave } = await import(/* @vite-ignore */ String("/src/shared/settlement/game-save-rows.ts"));
    const rows = splitGameSave(JSON.parse(text));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("island-settlers-db", 3);
      open.onupgradeneeded = () => {
        const database = open.result;
        for (const [name, keyPath] of [["accounts", "id"], ["adventures", "expeditionId"],
          ["colonies", "expeditionId"], ["islands", "id"], ["players", "id"], ["sessions", "id"]])
          database.createObjectStore(name!, { keyPath });
        database.createObjectStore("boot");
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const write = open.result.transaction(open.result.objectStoreNames, "readwrite");
        rows.islands.forEach((row: object) => write.objectStore("islands").put(row));
        rows.colonies.forEach((row: object) => write.objectStore("colonies").put(row));
        write.objectStore("players").put(rows.player ?? { id: "local", progress: { experience: 0, gems: 9 } });
        write.objectStore("sessions").put(rows.session);
        write.objectStore("accounts").put({ id: "acc1", usernameKey: "ada" });
        write.objectStore("boot").put("acc1", "game-owner");
        write.objectStore("boot").put("acc1", "current-account");
        write.objectStore("boot").put("pending", "startup");
        write.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const own = await openLocalSaveStore("acc1"), guest = await openLocalSaveStore();
    const migrated = (await own.readSavedGame())!, original = JSON.parse(text);
    return {
      guestEmpty: (await guest.readSavedGame()) === null, otherEmpty: (await (await openLocalSaveStore("acc2"))
        .readSavedGame()) === null,
      gems: migrated.player?.gems as number | undefined,
      sameGame: JSON.stringify(migrated.settlement) === JSON.stringify(original.settlement),
      startup: await own.readStartupGame(),
      // oxlint-disable-next-line eslint/no-eval -- dev review evaluates its table reader source in the page
      tables: await (0, eval)(tablesSource)() as Record<string, unknown[]>
    };
  }, [saved, `(${readTables.toString()})`] as const);
  assert.equal(result.sameGame, true);
  assert.equal(result.gems, JSON.parse(saved).player?.gems ?? 9);
  assert.deepEqual(result.tables.players, ["acc1"]);
  assert.equal(result.guestEmpty, true);
  assert.equal(result.otherEmpty, true);
  assert.equal(result.startup, "pending");
  assert.deepEqual(result.tables.accounts, ["acc1"]);
  assert.deepEqual(result.tables.islands, [["acc1", "home"]]);
  assert.deepEqual(result.tables.sessions, ["acc1"]);
  assert.equal(result.tables.boot!.includes("game-owner"), false);
  console.log("version 3 -> 4", JSON.stringify(result.tables));
  await page.context().close();
};

/** Removing one of two old local accounts deletes exactly its account row, game rows and boot values. */
const reviewAccountRemoval = async (browser: Browser, url: string) => {
  const page = await openFixturePage(browser, url);
  const result = await page.evaluate(async ([text, tablesSource]) => {
    const { openGameDatabase } = await import(/* @vite-ignore */ String("/src/app/settlement/game-database.ts"));
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const database = await openGameDatabase();
    await new Promise<void>(resolve => {
      const open = indexedDB.open("island-settlers-db");
      open.onsuccess = () => {
        const write = open.result.transaction("accounts", "readwrite");
        for (const [id, username] of [["acc1", "Ada"], ["acc2", "Bo"]])
          write.objectStore("accounts").put({ createdAt: 1, id, race: "roman", username,
            usernameKey: username!.toLowerCase() });
        write.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    for (const id of ["acc1", "acc2"]) {
      const slot = await openLocalSaveStore(id);
      await slot.writeSavedGame(JSON.parse(text));
      await slot.writeStartupGame(`${id}-startup`);
    }
    await (await openLocalSaveStore()).writeSavedGame(JSON.parse(text));
    await database.removeAccounts(["acc1"]);
    // oxlint-disable-next-line eslint/no-eval -- dev review evaluates its table reader source in the page
    return await (0, eval)(tablesSource)() as Record<string, unknown[]>;
  }, [saved, `(${readTables.toString()})`] as const);
  assert.deepEqual(result.accounts, ["acc2"]);
  assert.deepEqual(result.islands, [["acc2", "home"], ["guest", "home"]]);
  assert.deepEqual(result.sessions, ["acc2", "guest"]);
  assert.equal(result.boot!.includes("acc1/startup"), false);
  assert.equal(result.boot!.includes("acc2/startup"), true);
  console.log("remove one old account of two", JSON.stringify(result));
  await page.context().close();
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  await reviewSingleDocument(browser, url);
  await reviewVersion3Upgrade(browser, url);
  await reviewAccountRemoval(browser, url);
} finally { await browser.close(); await server.close(); }

import assert from "node:assert/strict";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Real IndexedDB check of the evacuations table (database version 5, owner decision 2026-10-15): a version 4
 * database whose session row still holds a freed colony's pickup upgrades, the first read moves the pickup
 * into `evacuations` keyed [slotId, expeditionId] and strips it from the session row, the game reads it back,
 * and a later save keeps it in its own table.
 * Run: npx tsx tools/bench/evacuation-table-review.ts
 */
const EVACUATION = { cargo: { stone: 4 }, deadline: 600_000, expeditionId: 3, name: "Gull Rock",
  troops: [{ hp: 100, rank: 1, type: "shield" }], voyageSeconds: 120 };

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/db-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}db-fixture.html`);
  const result = await page.evaluate(async evacuation => {
    const save = { format: "island-settlers-game", map: "home-map", progress: { fog: [], surveyed: [] }, savedAt: 1,
      settlement: {}, version: 1 };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("island-settlers-db", 4);
      open.onupgradeneeded = () => {
        const database = open.result;
        for (const name of ["adventures", "colonies"])
          database.createObjectStore(name, { keyPath: ["slotId", "expeditionId"] });
        database.createObjectStore("islands", { keyPath: ["slotId", "id"] });
        for (const name of ["accounts", "players", "sessions"]) database.createObjectStore(name, { keyPath: "id" });
        database.createObjectStore("boot");
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const write = open.result.transaction(["islands", "sessions"], "readwrite");
        write.objectStore("islands").put({ id: "home", save, slotId: "guest" });
        write.objectStore("sessions").put({ active: null, evacuations: [evacuation], id: "guest", savedAt: 1 });
        write.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    const { openGameDatabase } = await import(/* @vite-ignore */ String("/src/app/settlement/game-database.ts"));
    const database = await openGameDatabase();
    const game = await database.readGame("guest");
    const rows = await new Promise<{ evacuations: unknown[]; keys: unknown[]; session: Record<string, unknown> }>(
      resolve => {
        const open = indexedDB.open("island-settlers-db");
        open.onsuccess = () => {
          const read = open.result.transaction(["evacuations", "sessions"]);
          const evacuations = read.objectStore("evacuations").getAll();
          const keys = read.objectStore("evacuations").getAllKeys();
          const session = read.objectStore("sessions").get("guest");
          read.oncomplete = () => resolve({ evacuations: evacuations.result, keys: keys.result,
            session: session.result });
        };
      });
    await database.writeGame("guest", game);
    const again = await database.readGame("guest");
    return { again: again?.archipelago?.evacuations, game: game?.archipelago?.evacuations, ...rows };
  }, EVACUATION);
  assert.deepEqual(result.game, [EVACUATION]);
  assert.deepEqual(result.keys, [["guest", 3]]);
  assert.deepEqual(result.evacuations, [{ ...EVACUATION, slotId: "guest" }]);
  assert.equal("evacuations" in result.session, false);
  assert.deepEqual(result.again, [EVACUATION]);
  console.log("version 4 session pickup -> evacuations table", JSON.stringify(result.keys));
} finally { await browser.close(); await server.close(); }

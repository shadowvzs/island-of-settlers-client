import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createIdentityClient } from "../../src/app/account/identity-client";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Native standalone-editor catalog acceptance against the disposable local-dev stack (embedded
 * PostgreSQL, real identity service, real admin bootstrap and real catalog routes).
 *
 * Run: npx tsx tools/bench/editor-catalog-stack-review.ts
 */
const origin = "http://127.0.0.1:5292";
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const stack = await startAcceptanceStack(origin);
const { server, url } = await startDevServer({ env: { VITE_API_URL: stack.apiUrl,
  VITE_IDENTITY_URL: stack.identityUrl }, host: "127.0.0.1", port: 5292 });
const browser = await launchBrowser();
const suffix = randomBytes(5).toString("hex");
const credentials = { displayName: `Admin${suffix}`, email: `admin-${suffix}@example.test`,
  nation: "roman" as const, password: randomBytes(24).toString("base64url") };
const output = resolve(import.meta.dirname,
  "../../../resources/project-reviews/editor-catalog-2026-10-30/stack");
mkdirSync(output, { recursive: true });
const errors: string[] = [];
try {
  const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
  const registered = await identity.register(credentials);
  assert(registered.ok, "Admin registration failed");
  assert.equal(registered.account.role, "admin", "The first account must bootstrap as admin");

  // Sign in through the real game account dialog so the browser holds the identity refresh cookie,
  // then reuse that authenticated context for the standalone editor.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const login = await context.newPage();
  login.on("pageerror", error => errors.push(`login: ${error.message}`));
  await login.routeWebSocket("**/*", () => {});
  await login.goto(`${url}?quality=minimal&login=1`);
  await login.getByRole("dialog").first().waitFor({ timeout: 60_000 });
  await login.getByRole("textbox", { name: /^Email/ }).fill(credentials.email);
  await login.getByLabel(/^Password/).fill(credentials.password);
  await login.getByRole("button", { exact: true, name: "Sign in" }).click();
  await login.getByRole("heading", { name: "Choose a save slot" }).waitFor({ timeout: 60_000 });
  await login.close();

  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept());
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}editor.html?quality=minimal&size=128&seed=321&cache=0`);
  await page.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 30_000 }).catch(async error => {
    console.log(JSON.stringify({ debug: { cookies: await page.context().cookies(), errors,
      html: (await page.locator("body").innerText()).slice(0, 2000), title: await page.title(),
      url: page.url() } }));
    throw error;
  });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
  const publish = page.getByRole("button", { name: "Publish as shared starter map", exact: true });
  await publish.click();
  await page.waitForFunction(() => document.body.innerText.includes("Current starter: revision 1"),
    null, { timeout: 60_000 });
  await publish.click();
  await page.waitForFunction(() => document.body.innerText.includes("Current starter: revision 2"),
    null, { timeout: 60_000 }).catch(async error => {
      console.log(JSON.stringify({ publish2: { body: (await page.locator("body").innerText()).slice(0, 2500),
        rows: (await stack.pool.query("SELECT map_id, revision, hash FROM game.map_revisions ORDER BY revision")).rows,
        pointer: (await stack.pool.query("SELECT * FROM game.map_pointers WHERE name='starter'")).rows } }));
      throw error;
    });
  await page.locator(".map-editor__catalog-row").filter({ hasText: "r1" })
    .getByRole("button", { name: "Roll back the shared starter to this revision", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Current starter: revision 1"),
    null, { timeout: 60_000 });
  const current = (await stack.pool.query(`SELECT r.revision, r.hash FROM game.map_pointers p
    JOIN game.map_revisions r ON r.map_id = p.map_id AND r.revision = p.revision
    WHERE p.name = 'starter'`)).rows[0];
  assert.equal(current?.revision, 1, "PostgreSQL pointer must be back at revision 1");

  const hash = current!.hash as string;
  const corrupt = await page.evaluate(async hash => {
    const { openMapStorage, PUBLISHED_MAP_PREFIX } = await import(
      /* @vite-ignore */ String("/src/app/map-editor/map-storage.ts"));
    const storage = await openMapStorage();
    if (!storage) throw new Error("map storage unavailable");
    try {
      const id = `${PUBLISHED_MAP_PREFIX}${hash}`;
      await storage.write({ id, name: "corrupt", savedAt: 0, size: 3 }, new Uint8Array([1, 2, 3]));
      return Boolean(await storage.read(id));
    } finally { storage.close(); }
  }, hash);
  assert.equal(corrupt, true);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Current starter: revision 1"),
    null, { timeout: 60_000 });
  const report = { apiUrl: stack.apiUrl, identityUrl: stack.identityUrl, accountRole: registered.account.role,
    cacheCorruptionRecovered: true, currentRevision: current?.revision, errors, url };
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
  await stack.close();
}

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Native standalone-editor catalog acceptance against a local admin API. The server is deliberately
 * small and deterministic: it implements the same immutable revision, pointer and stale-hash
 * contract exercised by api/tests/map-catalog.test.ts while the browser uses the real editor UI.
 *
 * Run: npx tsx tools/bench/editor-catalog-publish-review.ts
 */
interface Revision {
  bytes: Uint8Array;
  hash: string;
  mapId: string;
  metadata: { name: string; savedAt?: number; source?: string };
  revision: number;
  size: number;
}
const id = randomUUID();
const token = (() => {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc({ exp: Math.floor(Date.now() / 1000) + 3600, role: "admin" })}.sig`;
})();
const account = { displayName: "Admin", id: "admin-1", nation: "roman", role: "admin" };
let revisions: Revision[] = [];
let current: Revision | null = null;
const description = (revision: Revision) => ({
  createdAt: new Date(0).toISOString(), hash: revision.hash, mapId: revision.mapId,
  metadata: revision.metadata, revision: revision.revision, size: revision.size
});
const json = (response: import("node:http").ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
};
const body = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
};
const api = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/config")
      return json(response, 200, { features: { mapCatalog: true } });
    if (request.method === "GET" && url.pathname === "/ready")
      return json(response, 200, { ready: true });
    if (request.method === "POST" && url.pathname === "/v1/auth/refresh")
      return json(response, 200, { accessToken: token, account });
    if (request.method === "GET" && url.pathname === "/v1/editor/access")
      return json(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/v1/maps/starter") {
      if (!current) return json(response, 404, { message: "No starter" });
      return json(response, 200, { ...description(current), bytesUrl: "/v1/maps/starter/bytes" });
    }
    if (request.method === "GET" && url.pathname === "/v1/maps/starter/bytes") {
      if (!current) return json(response, 404, { message: "No starter" });
      response.writeHead(200, { "Content-Type": "application/octet-stream", ETag: `"${current.hash}"` });
      response.end(Buffer.from(current.bytes)); return;
    }
    if (request.method === "GET" && url.pathname === "/v1/maps/starter/history")
      return json(response, 200, { current: current ? { ...description(current),
        bytesUrl: "/v1/maps/starter/bytes" } : null,
        revisions: [...revisions].reverse().map(description) });
    if (request.method === "POST" && url.pathname === "/v1/maps/starter") {
      const value = await body(request);
      const expectedHash = value.expectedHash as string | null;
      if ((current?.hash ?? null) !== expectedHash)
        return json(response, 409, { code: "MAP_POINTER_CONFLICT", message: "Starter changed" });
      const bytes = Buffer.from(String(value.bytes), "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const mapId = current?.mapId ?? id;
      const revision = (revisions.filter(entry => entry.mapId === mapId).at(-1)?.revision ?? 0) + 1;
      const entry = { bytes: new Uint8Array(bytes), hash, mapId,
        metadata: value.metadata as Revision["metadata"], revision, size: bytes.length };
      revisions.push(entry); current = entry;
      return json(response, 200, description(entry));
    }
    if (request.method === "POST" && url.pathname === "/v1/maps/starter/rollback") {
      const value = await body(request);
      if ((current?.hash ?? null) !== value.expectedHash)
        return json(response, 409, { code: "MAP_POINTER_CONFLICT", message: "Starter changed" });
      const found = revisions.find(entry => entry.mapId === value.mapId && entry.revision === value.revision);
      if (!found) return json(response, 404, { message: "Revision not found" });
      current = found;
      return json(response, 200, description(found));
    }
    return json(response, 404, { message: `No route ${request.method} ${url.pathname}` });
  } catch (error) {
    return json(response, 500, { message: error instanceof Error ? error.message : String(error) });
  }
});
await new Promise<void>((resolve, reject) => api.listen(0, "127.0.0.1", () => resolve()));
const address = api.address() as AddressInfo;
const apiUrl = `http://127.0.0.1:${address.port}`;
const currentRevision = () => current;
const output = resolve(import.meta.dirname, "../../../resources/project-reviews/editor-catalog-2026-10-30/publish");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer({ env: { VITE_API_URL: apiUrl, VITE_IDENTITY_URL: apiUrl } });
const browser = await launchBrowser();
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept());
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}editor.html?quality=minimal&size=128&seed=321&cache=0`);
  await page.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  const mapTab = page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true });
  await mapTab.waitFor({ state: "visible" });
  await mapTab.click();
  const publish = page.getByRole("button", { name: "Publish as shared starter map", exact: true });
  await publish.click();
  await page.waitForFunction(() => document.body.innerText.includes("Current starter: revision 1"),
    null, { timeout: 60_000 });
  assert.equal(currentRevision()?.revision, 1);
  await publish.click();
  await page.waitForFunction(() => document.body.innerText.includes("Current starter: revision 2"),
    null, { timeout: 60_000 });
  assert.equal(currentRevision()?.revision, 2);
  const rollback = page.locator(".map-editor__catalog-row").filter({ hasText: "r1" })
    .getByRole("button", { name: "Roll back the shared starter to this revision", exact: true });
  await rollback.click();
  await page.waitForFunction(() => document.body.innerText.includes("Current starter: revision 1"),
    null, { timeout: 60_000 });
  assert.equal(currentRevision()?.revision, 1);

  // Cache the authoritative bytes, then replace them with corrupt data. A reload must refetch by
  // the immutable hash rather than displaying or trusting the corrupt cache entry.
  const active = currentRevision();
  assert(active);
  const hash = active.hash;
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
  assert.equal(currentRevision()?.revision, 1);
  const report = { apiUrl, cacheCorruptionRecovered: true, errors, revisions: revisions.length,
    current: current && description(current), url };
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
  await new Promise<void>(resolve => api.close(() => resolve()));
}

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";

import { decodeCommandLog } from "../../../island-of-settlers-api/src/command-log-codec";
import { appendLedger } from "../../../island-of-settlers-api/src/economy/ledger";
import { lockWallets, transaction } from "../../../island-of-settlers-api/src/economy/repository";
import { createSaveRepository } from "../../../island-of-settlers-api/src/save-repository";
import { encodeSnapshot } from "../../../island-of-settlers-api/src/snapshot-codec";
import { compressHistory } from "../../../island-of-settlers-api/src/snapshot-history";
import { readVerificationConfig } from "../../../island-of-settlers-api/src/verification/verification-config";
import { createIdentityClient } from "../../src/app/account/identity-client";
import { createCommanderRecoveryTransport } from "../../src/app/cloud/commander-recovery-client";
import { createEconomyClient } from "../../src/app/cloud/economy-client";
import { createSaveApiClient } from "../../src/app/save-store/save-api-client";
import { toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { gameSourceFolders, sourceFingerprints } from "../source-version-plugin";
import { launchBrowser, startDevServer } from "./browser";
import { createRecoveryAccountFixture } from "./commander-recovery-account-fixture";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "commander-recovery-account-2026-11-04");
await mkdir(output, { recursive: true });
const bundleRoot = await mkdtemp(join(tmpdir(), "commander-account-verifier-"));
const client = resolve(import.meta.dirname, "../..");
const worker = resolve(client, "../island-of-settlers-worker-generation");
const { sourceVersion } = sourceFingerprints(gameSourceFolders(client, worker));
await build({ bundle: true, entryPoints: [join(client, "src/app/settlement/server-bundle.ts")],
  format: "esm", outfile: join(bundleRoot, sourceVersion, "verifier.mjs"), platform: "node", target: "node22" });
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const stack = await startAcceptanceStack("http://127.0.0.1:5294", {
  verification: { ...readVerificationConfig(), directory: bundleRoot, globalRssMb: 0, sampleRate: 1 }
});
let dev: Awaited<ReturnType<typeof startDevServer>> | undefined;
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const errors: string[] = [], rows: unknown[] = [];
let status = "failed";
const prepareOnly = process.argv.includes("--prepare");
try {
  const fixture = await createRecoveryAccountFixture();
  const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
  const suffix = randomBytes(5).toString("hex");
  const credentials = { displayName: `Recovery${suffix}`, email: `recovery-${suffix}@example.test`,
    nation: "roman" as const, password: randomBytes(24).toString("base64url") };
  const bootstrap = await identity.register({ ...credentials, displayName: `Bootstrap${suffix}`,
    email: `bootstrap-${suffix}@example.test`, password: randomBytes(24).toString("base64url") });
  assert(bootstrap.ok && bootstrap.account.role === "admin", "Private bootstrap account must be separate");
  const registered = await identity.register(credentials);
  assert(registered.ok, "Private acceptance account registration must succeed");
  assert.equal(registered.account.role, "player", "Recovery acceptance must use ordinary account authority");
  const account = registered.account.id;
  await transaction(stack.pool, async (db: any) => {
    await lockWallets(db, [account]);
    await appendLedger(db, { account, gems: 100, kind: "admin-grant", ref: randomUUID(), requestId: "private-fixture" });
  });
  const repository = createSaveRepository(stack.pool);
  const slot = await repository.create(account, 1, "Commander recovery acceptance");
  const snapshot = toSaveSnapshot(fixture.game);
  const seeded = await repository.putSnapshot(account, slot.id, 0, await encodeSnapshot(snapshot), await compressHistory(snapshot),
    undefined, sourceVersion, null, { kind: "catch-up" });
  // This is a deliberately seeded known-valid checkpoint, not a claim of historical gameplay verification.
  await stack.pool.query("UPDATE game.save_slots SET verified_revision=$2 WHERE id=$1", [slot.id, seeded.revision]);
  await stack.pool.query("INSERT INTO game.verified_island_anchors(slot_id,island_key,revision) VALUES($1,'home',$2)",
    [slot.id, seeded.revision]);
  assert.equal((await stack.pool.query("SELECT verified_revision FROM game.save_slots WHERE id=$1", [slot.id]))
    .rows[0].verified_revision, 1);
  console.log(JSON.stringify({ phase: "prepared", fixtureValidated: true, sourceVersion, slotRevision: 1,
    realIdentity: true, realPostgres: true, canonicalVerifierEnabled: true }));
  if (prepareOnly) {
    const access = { apiUrl: stack.apiUrl, getAccessToken: identity.accessToken, renewAccessToken: identity.renew };
    const api = createSaveApiClient(access), lease = await api.acquireLease(false);
    assert(lease.ok, "Authenticated private account must acquire a real session lease");
    const economy = createEconomyClient(access);
    const purchase = await economy.buyGemOffer("commander-recovery", randomUUID());
    assert(purchase.ok, "Actual authenticated HTTP purchase must succeed");
    const transport = createCommanderRecoveryTransport({ ...access, leaseId: () => lease.lease.leaseId });
    const body = { commanderId: fixture.commanderId, idempotencyKey: randomUUID(), revision: 1, slotId: slot.id };
    const recovered = await transport.recover(body);
    assert(recovered.ok, "Actual authenticated leased recovery HTTP route must succeed");
    assert.equal(recovered.revision, 2);
    assert.equal(recovered.wallet.items.commanderRecovery, undefined);
    assert.equal(recovered.wallet.gems, 50);
    const retried = await transport.recover(body);
    assert(retried.ok); assert.equal(retried.revision, 2);
    assert.deepEqual(retried.wallet, recovered.wallet);
    await api.releaseLease(lease.lease.leaseId);
    rows.push({ phase: "prepared", fixtureValidated: true, canonicalVerifierEnabled: true,
      authenticatedPurchaseAndLeasedRecoveryHttp: true, revision: recovered.revision,
      consumedOnce: true, duplicateReceiptIdentical: true });
    status = "prepared";
  } else {
    dev = await startDevServer({ env: { VITE_API_URL: stack.apiUrl, VITE_IDENTITY_URL: stack.identityUrl },
      host: "127.0.0.1", port: 5294 });
    browser = await launchBrowser();
    for (const quality of ["high", "minimal"] as const) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript(quality => {
        localStorage.setItem("island-of-settlers.graphics.detail", quality);
        localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
        localStorage.setItem("island-of-settlers.sound", "0");
      }, quality);
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.routeWebSocket("**/*", () => {});
      await page.goto(`${dev.url}?login=1&cache=0`);
      const servedVersion = await page.evaluate(async () => {
        const module = await import(/* @vite-ignore */ String("/@id/__x00__virtual:source-version"));
        return module.SOURCE_VERSION;
      });
      assert.equal(servedVersion, sourceVersion, "Browser and worker must use the same frozen source tree");
      await page.getByRole("textbox", { name: /^Email/ }).fill(credentials.email);
      await page.getByLabel(/^Password/).fill(credentials.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("heading", { name: "Choose a save slot" }).waitFor({ timeout: 60000 });
      await page.getByRole("button", { name: /^Slot 1:/ }).click();
      await page.waitForFunction(() => Boolean((window as any).__islandReady) ||
        [...document.querySelectorAll("button")].some(button => button.textContent?.includes("Take over here")),
      null, { timeout: 180000 });
      const takeover = page.getByRole("button", { name: /Take over here/ });
      if (await takeover.isVisible()) await takeover.click();
      await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
        null, { timeout: 180000 });
      await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180000 });
      const before = await page.evaluate(() => {
        const { playerSession, simulation } = (window as any).__settlement;
        return { gems: playerSession.progress().gems, commander: simulation.commanderSnapshot() };
      });
      assert.equal(before.commander.id, fixture.commanderId);
      await page.locator(".player-hud__gems").click();
      await page.getByRole("tab", { name: "Items", exact: true }).click();
      const offer = page.locator('[data-offer-id="commander-recovery"]');
      const purchased = page.waitForResponse(response => response.url().endsWith("/v1/economy/gem-shop/purchases"));
      await offer.getByRole("button").click();
      const purchaseResponse = await purchased;
      assert.equal(purchaseResponse.status(), 200);
      const purchaseReceipt = await purchaseResponse.json();
      await page.waitForFunction(() => (window as any).__settlement.playerSession.progress().inventory.commanderRecovery === 1);
      await page.locator(".settlement-ui__gem-shop-window").getByRole("button", { name: /^Close .* window$/ }).click();
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("button", { name: "Inventory", exact: true }).click();
      await page.locator('[data-item-id="commanderRecovery"]').click();
      const dialog = page.locator(".commander-recovery-window:not([hidden])");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal((await stack.pool.query("SELECT units FROM economy.player_items WHERE account_id=$1 AND item_id='commanderRecovery'", [account])).rows[0].units, 1);
      await page.locator('[data-item-id="commanderRecovery"]').click();
      await page.screenshot({ path: join(output, `${quality}-confirmation.png`) });
      const response = page.waitForResponse(response => response.url().endsWith("/v1/economy/items/commander-recovery"),
        { timeout: 90000 });
      const refusal = dialog.getByText(/Save verification is pending/).waitFor({ timeout: 90000 }).then(() => {
        throw new Error("Actual account save verification refused recovery; retain item and diagnose stored replay");
      });
      await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
      const received = await Promise.race([response, refusal]);
      const receipt = await received.json();
      assert.equal(received.status(), 200, JSON.stringify(receipt));
      await writeFile(join(output, `${quality}-server-receipt.json`), JSON.stringify(receipt, null, 2));
      await page.waitForFunction(() => !(window as any).__settlement.playerSession.progress().inventory.commanderRecovery);
      await page.waitForFunction(({ commanderId }) => {
        const commander = (window as any).__settlement?.simulation.commanderSnapshot();
        return commander?.id === commanderId && commander.hp === commander.maximumHp && commander.ready;
      }, { commanderId: fixture.commanderId }, { timeout: 15000 });
      const after = await page.evaluate(() => {
        const { playerSession, simulation } = (window as any).__settlement;
        const saved = simulation.saveState(), commander = simulation.commanderSnapshot();
        const soldier = saved.military.soldiers.find((row: any) => row.commanderId === commander.id);
        return { commander, actor: soldier.actor, mount: soldier.combat.mount, gems: playerSession.progress().gems,
          commanderCount: saved.military.soldiers.filter((row: any) => row.commanderId === commander.id).length };
      });
      assert.equal(after.commander.id, fixture.commanderId);
      assert.equal(after.actor, fixture.actor); assert.equal(after.mount, fixture.mount);
      assert.equal(after.commander.hp, after.commander.maximumHp); assert.equal(after.commander.ready, true);
      assert.equal(after.commanderCount, 1);
      assert.equal(after.gems, receipt.wallet.gems);
      const paid = await stack.pool.query("SELECT gems FROM economy.ledger WHERE account_id=$1 AND kind='gem-shop' ORDER BY created_at", [account]);
      assert(paid.rows.length > 0 && paid.rows.every((row: any) => Number(row.gems) === -50));
      assert.equal((await stack.pool.query("SELECT count(*)::int AS count FROM economy.player_items WHERE account_id=$1 AND item_id='commanderRecovery'", [account])).rows[0].count, 0);
      await page.screenshot({ path: join(output, `${quality}-recovered.png`) });
      const repeated = await context.request.post(received.url(), {
        data: received.request().postDataJSON(), headers: await received.request().allHeaders()
      });
      assert.equal(repeated.status(), 200);
      assert.equal((await repeated.json()).revision, receipt.revision);
      await page.reload();
      await page.waitForFunction(() => Boolean((window as any).__islandReady &&
        (window as any).__settlement?.simulation.commanderSnapshot()?.ready), null, { timeout: 180000 });
      const reloaded = await page.evaluate(() => {
        const { playerSession, simulation } = (window as any).__settlement;
        return { commanderId: simulation.commanderSnapshot().id,
          item: playerSession.progress().inventory.commanderRecovery ?? 0 };
      });
      assert.deepEqual(reloaded, { commanderId: fixture.commanderId, item: 0 });
      rows.push({ quality, accountRole: registered.account.role, realAuthenticatedHttp: true,
        cancelRetainsItemInDatabase: true, purchaseReceipt, receipt,
        sameCommanderActorHorse: true, repeatedRequestSameReceipt: true, reloadRetainsRecovery: true, after });
      await context.close();
      if (quality === "high") {
        // Next independent rendered LOD uses the same finite fixture at a newer verified revision.
        const revision = await repository.getRevision(account, slot.id);
        const fresh = await createRecoveryAccountFixture();
        const currentWallet = (await stack.pool.query("SELECT gems FROM economy.wallets WHERE account_id=$1", [account])).rows[0];
        fresh.game.player!.gems = Number(currentWallet.gems);
        const nextSnapshot = toSaveSnapshot(fresh.game);
        const next = await repository.putSnapshot(account, slot.id, revision, await encodeSnapshot(nextSnapshot),
          await compressHistory(nextSnapshot), undefined, sourceVersion, null, { kind: "catch-up" });
        await stack.pool.query("UPDATE game.save_slots SET verified_revision=$2 WHERE id=$1", [slot.id, next.revision]);
        await stack.pool.query("UPDATE game.verified_island_anchors SET revision=$2 WHERE slot_id=$1 AND island_key='home'", [slot.id, next.revision]);
      }
    }
    assert.deepEqual(errors, []); status = "passed";
  }
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
  const page = browser?.contexts().at(-1)?.pages().at(-1);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => undefined);
    await writeFile(join(output, "failure.txt"), await page.locator("body").innerText().catch(() => "Page unavailable"));
    const local = await page.evaluate(() => {
      const settlement = (window as any).__settlement;
      if (!settlement) return null;
      return { settlement: settlement.simulation.saveState(), commander: settlement.simulation.commanderSnapshot(),
        player: settlement.playerSession.progress() };
    }).catch(() => null);
    await writeFile(join(output, "failure-client-state.json"), JSON.stringify(local, null, 2));
    const slots = await stack.pool.query("SELECT revision,verified_revision,flag_detail,source_version FROM game.save_slots");
    await writeFile(join(output, "failure-verification.json"), JSON.stringify(slots.rows, null, 2));
    const logs = await stack.pool.query("SELECT revision,source_version,verification,verification_detail FROM game.command_logs");
    await writeFile(join(output, "failure-command-logs.json"), JSON.stringify(logs.rows, null, 2));
    const stored = await stack.pool.query(`SELECT l.*,b.compressed_snapshot AS base_snapshot,
      e.compressed_snapshot AS end_snapshot FROM game.command_logs l
      JOIN game.snapshot_history e ON e.slot_id=l.slot_id AND e.revision=l.revision
      JOIN game.snapshot_history b ON b.slot_id=l.slot_id AND b.revision=l.base_revision`);
    const inputs = await Promise.all(stored.rows.map(async (row: any) => ({
      sourceVersion: row.source_version, revision: row.revision, baseRevision: row.base_revision,
      allowDebug: row.debug_commands > 0,
      base: JSON.parse(gunzipSync(row.base_snapshot).toString("utf8")),
      end: JSON.parse(gunzipSync(row.end_snapshot).toString("utf8")),
      intervals: await decodeCommandLog(row.compressed_log, row.uncompressed_bytes)
    })));
    await writeFile(join(output, "failure-replay-inputs.json"), JSON.stringify(inputs));
  }
  throw error;
} finally {
  await browser?.close(); await dev?.server.close(); await stack.close();
  await writeFile(join(output, prepareOnly ? "prepare-report.json" : "report.json"), JSON.stringify({
    status, sourceVersion, bundleVersions: [sourceVersion], rows, errors,
    scope: prepareOnly
      ? "Private real identity/PostgreSQL/API/canonical-worker checkpoint: authenticated HTTP purchase, lease, recovery and duplicate receipt; no browser run. Starting historical checkpoint is seeded."
      : "Private real identity/PostgreSQL/API/canonical-worker account checkpoint; historical checkpoint is seeded, rendered purchase and recovery use real application paths."
  }, null, 2));
}

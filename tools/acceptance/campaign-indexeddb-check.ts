import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

import { createCampaign, createCampaignMap } from "../../../island-of-settlers-shared/src/campaign/campaign-model";
import { getChromeLaunchOptions } from "../bench/chrome";

/**
 * Real-browser check of the IndexedDB campaign repository (lane C1): Node has no IndexedDB, so the shared
 * repository contract runs over the memory store in unit tests and this tool runs the IndexedDB store once in
 * Chrome through the Vite dev server. Run through the browser slot:
 * `<worktree>/captures/browser-slot.sh npx tsx tools/acceptance/campaign-indexeddb-check.ts`.
 */
const PORT = Number(process.env.CAMPAIGN_IDB_PORT ?? 5391);
const STORE_MODULE = "/src/app/campaign-storage/campaign-indexeddb-store.ts";

const startVite = () => spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });

const waitForVite = async () => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(`http://localhost:${PORT}/@vite/client`)).ok) return; } catch { /* still starting */ }
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error("The Vite dev server did not start");
};

type Templates = { campaign: ReturnType<typeof createCampaign>; map: ReturnType<typeof createCampaignMap> };

/** Runs inside the page: the repository contract's core cases over the real IndexedDB store. */
const pageChecks = async ({ campaign: campaignTemplate, map: mapTemplate, storeModule }: Templates & {
  storeModule: string;
}) => {
  const storage: typeof import("../../src/app/campaign-storage/campaign-indexeddb-store") = await import(storeModule);
  const repositories = await storage.openCampaignIndexedDbRepositories();
  if (!repositories) return ["FAIL IndexedDB unavailable"];
  const checks: string[] = [];
  const expect = (label: string, passed: boolean) => checks.push(`${passed ? "ok" : "FAIL"} ${label}`);
  const rejects = async (label: string, run: () => Promise<unknown>, errorName: string) => {
    try { await run(); expect(label, false); } catch (error) { expect(label, (error as Error).name === errorName); }
  };
  const { campaigns, images, maps } = repositories;
  const prefix = `idb-${Date.now()}`;
  const campaign = { ...campaignTemplate, id: `${prefix}-c` };
  const created = await campaigns.create(campaign);
  expect("create answers revision 1", created.revision === 1);
  expect("get answers the stored record", JSON.stringify(await campaigns.get(campaign.id)) === JSON.stringify(created));
  await rejects("a duplicate create conflicts", () => campaigns.create(campaign), "CampaignRecordConflict");
  expect("update answers revision 2", (await campaigns.update({ ...created, state: "ready" })).revision === 2);
  await rejects("a stale update conflicts", () => campaigns.update(created), "CampaignRecordConflict");
  const ready = await campaigns.list({ state: "ready" });
  expect("the state filter finds it", ready.some(entry => entry.id === campaign.id));
  const map = { ...mapTemplate, campaignId: campaign.id, id: `${prefix}-m` };
  await maps.create(map);
  await maps.create({ ...map, campaignId: `${prefix}-other`, id: `${prefix}-m2` });
  const listed = await maps.list({ campaignId: campaign.id, state: "draft" });
  expect("the campaign filter lists one map", listed.length === 1 && listed[0]?.id === map.id);
  await images.create({ bytes: new Uint8Array([1, 2, 3, 250]), campaignId: campaign.id, height: 2,
    id: `${prefix}-i`, mimeType: "image/webp", revision: 0, updatedAt: 0, width: 2 });
  const image = await images.get(`${prefix}-i`);
  expect("image bytes round-trip", image?.bytes instanceof Uint8Array && [...image!.bytes].join() === "1,2,3,250");
  await rejects("a stale delete conflicts", () => campaigns.delete(campaign.id, 1), "CampaignRecordConflict");
  await campaigns.delete(campaign.id, 2);
  expect("delete removes it", (await campaigns.get(campaign.id)) === null);
  await rejects("deleting again is not found", () => campaigns.delete(campaign.id, 2), "CampaignRecordNotFound");
  return checks;
};

const vite = startVite();
try {
  await waitForVite();
  const browser = await chromium.launch(getChromeLaunchOptions());
  const page = await browser.newPage();
  // tsx keeps function names through a `__name` helper the page does not have.
  await page.addInitScript("globalThis.__name = (target) => target;");
  await page.goto(`http://localhost:${PORT}/@vite/client`);
  const checks = await page.evaluate(pageChecks, {
    campaign: createCampaign("template"),
    map: createCampaignMap("template", "template", { hash: null, id: "slot" }),
    storeModule: STORE_MODULE
  });
  await browser.close();
  console.log(checks.join("\n"));
  if (checks.some(check => check.startsWith("FAIL"))) process.exitCode = 1;
} finally {
  vite.kill();
}

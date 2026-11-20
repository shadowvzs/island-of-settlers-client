import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { wareEntries, wareEntry } from "@shared/catalog";

import { catalogIconFile } from "../assets/catalog-asset-files";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";
import { AUTHORED_WARE_ICONS, renderWareIcon, setupWareIconRenderer } from "./ware-icon-renderer";

const review = resourcesPath("settlement-previews", "ware-icons");
const requested = new Set(process.argv.slice(2));
/** Every catalog ware (`ware:*` `icon`), in catalog order. */
const ICON_IDS: readonly string[] = wareEntries().map(entry => entry.key);
const selected = requested.size ? ICON_IDS.filter(id => requested.has(id)) : ICON_IDS;
const output = dirname(catalogIconFile(wareEntries()[0]!));
const reviewName = requested.size ? selected.join("-") : "all-ware-icons";
mkdirSync(output, { recursive: true });
mkdirSync(review, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/ware-icon-render.html", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body></body></html>"
  }));
  await page.addInitScript("window.__name = value => value;");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${url}ware-icon-render.html`);
  try {
    await page.evaluate(setupWareIconRenderer);
  } catch (error) {
    throw new Error(`Ware icon renderer failed: ${errors.join("\n")}\n${String(error)}`, { cause: error });
  }
  const reports: unknown[] = [];
  for (const id of selected) {
    if (AUTHORED_WARE_ICONS.has(id)) {
      reports.push({ id, source: "authored artwork", preserved: true });
      continue;
    }
    const result = await page.evaluate(renderWareIcon, id);
    writeFileSync(catalogIconFile(wareEntry(id)!), Buffer.from(result.png, "base64"));
    reports.push(result.stats);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(resolve(review, requested.size ? `${reviewName}-review.json` : "review.json"), JSON.stringify({ icons: reports, errors }, null, 2));
  const cards = selected.map(id => `<figure><img src="${url}assets/ware-icons/${id}.png"><figcaption>${id}</figcaption></figure>`);
  await page.setContent(`<style>body{margin:0;padding:20px;background:#e7ddc5;color:#493b27;font:14px serif}
    main{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}figure{margin:0;text-align:center;padding:8px;
    background:#f8efdb;border:1px solid #c1ab81;border-radius:8px;box-shadow:0 2px 5px #5f472733}
    img{display:block;width:150px;height:150px;margin:auto}figcaption{margin-top:3px}</style>
    <main>${cards.join("")}</main>`);
  await page.evaluate(async () => Promise.all(Array.from(document.images).map(image => image.decode())));
  await page.screenshot({ path: resolve(review, `${reviewName}.png`), fullPage: true });
  await page.evaluate(() => {
    const state = (window as any).__wareIcons;
    if (!state) return;
    for (const model of state.models.values()) model.dispose();
    state.materialPack.dispose(); state.reflection.dispose(); state.renderer.dispose();
  });
  console.log(`Reviewed ${selected.length} ware icons; authored artwork preserved: ${output}`);
} finally { await browser.close(); await server.close(); }

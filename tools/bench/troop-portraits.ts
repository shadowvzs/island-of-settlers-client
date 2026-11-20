import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { soldierEntry } from "@shared/catalog";

import { catalogAssetFile } from "../assets/catalog-asset-files";
import { launchBrowser, startDevServer } from "./browser";
import type { TroopPortrait } from "./troop-portraits-scene";

/**
 * Troop portraits (`npm run troop-portraits`): each nation's shield, heavy, archer and cavalry
 * soldier model idle on a transparent background (tools/bench/troop-portraits-scene.ts), written
 * to the catalog's `soldier.portrait.ranked` files for rank-aware troop lists; the generic
 * `soldier.portrait.path` images retain the Soldier tier for unranked summaries.
 */
const SIZE = 256;

/** The catalog portrait file of one rendered portrait. */
const portraitFile = ({ nation, rank, troop }: TroopPortrait) => {
  const { path, ranked } = soldierEntry(troop)!.soldier.portrait;
  if (rank === undefined) return catalogAssetFile(path, { key: troop, nation });
  return catalogAssetFile(ranked!, { key: troop, nation, rank });
};

const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/troop-portraits.html", route => route.fulfill({ contentType: "text/html",
    body: "<!doctype html><meta charset='utf-8'><body style='margin:0'>" }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}troop-portraits.html`);
  const portraits: TroopPortrait[] = await page.evaluate(async ({ nations, size }) => {
    const { renderTroopPortraits } = await import(/* @vite-ignore */ String("/tools/bench/troop-portraits-scene.ts"));
    return renderTroopPortraits(size, nations as any);
  }, { size: SIZE, nations: process.env.NATIONS?.split(",") });
  if (errors.length) throw new Error(errors.join("\n"));
  for (const portrait of portraits) {
    const file = portraitFile(portrait);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(portrait.png, "base64"));
  }
  console.log(JSON.stringify({ portraits: portraits.length }));
} finally { await browser.close(); await server.close(); }

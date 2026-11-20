import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Commander head portraits (`npm run commander-portraits`): the real national mounted commander's
 * face and centurion helmet, written to assets/commander-portraits/<nation>.png for every consumer.
 */
const SIZE = 256;
const output = resolve("assets/commander-portraits");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/commander-portraits.html", route => route.fulfill({ contentType: "text/html",
    body: "<!doctype html><meta charset='utf-8'><body style='margin:0'>" }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}commander-portraits.html`);
  const portraits = await page.evaluate(async () => {
    const { renderCommanderPortraits } = await import(
      /* @vite-ignore */ String("/tools/bench/commander-portraits-scene.ts"));
    return renderCommanderPortraits();
  }) as Array<{ name: string; png: string }>;
  if (errors.length) throw new Error(errors.join("\n"));
  for (const { name, png } of portraits) writeFileSync(resolve(output, `${name}.png`), Buffer.from(png, "base64"));
  console.log(JSON.stringify({ output, portraits: portraits.map(portrait => portrait.name) }));
} finally {
  await browser.close();
  await server.close();
}

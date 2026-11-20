import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
let result: unknown;
try {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(new URL("__export_control__.html", url).href);
  result = await page.evaluate(async () => {
    const fixture = await import(/* @vite-ignore */ String("/tools/bench/building-export-normal-fixture.ts"));
    return fixture.runExportNormalFixture();
  });
} finally {
  await browser?.close();
  await server.close();
  console.log("FULL CLOSED: browser and Vite server");
}
const output = resolve("../resources/project-reviews/building-assets-sync-2026-11-04/full-b");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "export-data-texture-roundtrip-b.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

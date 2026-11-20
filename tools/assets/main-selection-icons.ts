import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "../bench/browser";
import { resourcesPath } from "../bench/resources-path";

const names = ["floppy-disk", "statistics"] as const;
const source = resourcesPath("ui-icon-sources", "main-selection");
const output = resolve("assets/ui-icons");
const { server, url } = await startDevServer();
const browser = await launchBrowser();

try {
  mkdirSync(output, { recursive: true });
  const page = await browser.newPage();
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/icon-source/*.png", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
    // Serve only the two known originals; resources stay outside Vite's general file access.
    if (!names.some((entry) => `${entry}.png` === name)) return route.abort();
    return route.fulfill({ contentType: "image/png", body: readFileSync(resolve(source, name)) });
  });
  await page.route("**/main-icons-source.html", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body>" })
  );
  await page.goto(`${url}main-icons-source.html`);
  for (const name of names) {
    const encoded = await page.evaluate(async (name) => {
      const image = new Image();
      image.src = `/icon-source/${name}.png`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      canvas.getContext("2d")!.drawImage(image, 0, 0, 256, 256);
      return canvas.toDataURL("image/webp", 0.9).split(",")[1]!;
    }, name);
    writeFileSync(resolve(output, `${name}.webp`), Buffer.from(encoded, "base64"));
  }
  console.log("Main-selection WebP icons generated from workspace originals.");
} finally {
  await browser.close();
  await server.close();
}

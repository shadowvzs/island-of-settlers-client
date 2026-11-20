import { writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/** The Japanese sail painting composed flat at 1024 px over the real linen (settlement-previews/nation-ships). */

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/flat.html", route => route.fulfill({ contentType: "text/html", body: "<body>" }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}flat.html`);
  const png = await page.evaluate(async () => {
    const S = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/ship-nation-sails.ts"));
    const A = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/ship-sail-artwork.ts"));
    const artwork = await A.loadShipSailArtwork(true);
    const cloth = new Image(); cloth.src = "/assets/textures/ships/roman-linen-high.webp"; await cloth.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
    const c = canvas.getContext("2d")!; c.drawImage(cloth, 0, 0, 1024, 1024);
    c.scale(1024, 1024); c.globalCompositeOperation = "multiply";
    S.NATION_SAIL_PAINTINGS.japaneseCloth(c, { ...artwork, cloth });
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  writeFileSync(resourcesPath("settlement-previews", "nation-ships", "japanese-sail-flat.png"),
    Buffer.from(png, "base64"));
} finally { await browser.close(); await server.close(); }

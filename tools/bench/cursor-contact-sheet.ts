import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { renderGameCursors } from "./game-cursor-renderer";

/**
 * Contact sheet of the game cursor set: each cursor at 1x (32 px) and 2x (64 px) on light, dark, snow and
 * water backdrops, plus a 4x nearest-neighbour zoom of the 1x image with its hotspot marked.
 * Run: npx tsx --env-file=<file with OUT=<folder>, optionally ONLY=game-default,army-move>
 *   tools/bench/cursor-contact-sheet.ts
 */
const out = process.env.OUT ?? "/tmp/cursor-contact-sheet";
const only = process.env.ONLY?.split(",");

/** Draws the sheet in the page (procedural backdrops, so the sheet needs no asset files). */
const drawSheet = (cursors: Record<string, { hotspot: readonly number[]; png: Record<string, string> }>) => {
  const BACKDROPS = ["light", "dark", "snow", "water"] as const;
  const CELL = 84, ZOOM = 4, LABEL = 150, ROW = 32 * ZOOM + 8, ZOOM_WIDTH = 32 * ZOOM + 16;
  const names = Object.keys(cursors);
  const canvas = document.createElement("canvas");
  canvas.width = LABEL + BACKDROPS.length * CELL * 2 + ZOOM_WIDTH;
  canvas.height = 28 + names.length * ROW;
  const context = canvas.getContext("2d")!;
  const paintBackdrop = (kind: (typeof BACKDROPS)[number], x: number, y: number) => {
    const fills = { dark: ["#101317", "#1d2229"], light: ["#f3ead2", "#e0d2ae"], snow: ["#ffffff", "#dfe9f2"],
      water: ["#0d3a52", "#1b6a80"] };
    const gradient = context.createLinearGradient(x, y, x + CELL, y + CELL);
    gradient.addColorStop(0, fills[kind][0]!); gradient.addColorStop(1, fills[kind][1]!);
    context.fillStyle = gradient; context.fillRect(x, y, CELL, CELL);
    if (kind !== "snow" && kind !== "water") return;
    for (let index = 0; index < 60; index++) {
      const px = x + (index * 37 % CELL), py = y + (index * 53 % CELL);
      context.fillStyle = kind === "snow" ? "rgba(170, 196, 220, .35)" : "rgba(160, 220, 235, .28)";
      context.fillRect(px, py, kind === "snow" ? 2 : 7, kind === "snow" ? 2 : 1);
    }
  };
  const load = (base64: string) => new Promise<HTMLImageElement>(resolve => {
    const image = new Image(); image.onload = () => resolve(image); image.src = `data:image/png;base64,${base64}`;
  });
  context.fillStyle = "#3a3a3a"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = "12px sans-serif"; context.fillStyle = "#eee";
  BACKDROPS.forEach((kind, index) => {
    context.fillText(`${kind} 1x`, LABEL + index * CELL * 2 + 4, 18);
    context.fillText(`${kind} 2x`, LABEL + index * CELL * 2 + CELL + 4, 18);
  });
  context.fillText("1x at 4x, red = hotspot", LABEL + BACKDROPS.length * CELL * 2 + 4, 18);
  return (async () => {
    for (const [row, name] of names.entries()) {
      const top = 28 + row * ROW, y = top + (ROW - CELL) / 2, { hotspot, png } = cursors[name]!;
      const [small, large] = await Promise.all([load(png["1x"]!), load(png["2x"]!)]);
      context.fillStyle = "#eee";
      context.fillText(name, 6, y + 30); context.fillText(`hotspot ${hotspot.join(" ")}`, 6, y + 48);
      BACKDROPS.forEach((kind, index) => {
        const x = LABEL + index * CELL * 2;
        paintBackdrop(kind, x, y); paintBackdrop(kind, x + CELL, y);
        context.drawImage(small, x + 26, y + 26);
        context.drawImage(large, x + CELL + 10, y + 10);
      });
      const zoomX = LABEL + BACKDROPS.length * CELL * 2 + 8;
      for (let cell = 0; cell < 64; cell++) {
        context.fillStyle = (cell + (cell >> 3)) % 2 ? "#9a9a9a" : "#c8c8c8";
        context.fillRect(zoomX + cell % 8 * 16, top + 4 + (cell >> 3) * 16, 16, 16);
      }
      context.imageSmoothingEnabled = false;
      context.drawImage(small, zoomX, top + 4, 32 * ZOOM, 32 * ZOOM);
      context.imageSmoothingEnabled = true;
      context.strokeStyle = "#ff2020";
      context.strokeRect(zoomX + hotspot[0]! * ZOOM + .5, top + 4 + hotspot[1]! * ZOOM + .5, ZOOM - 1, ZOOM - 1);
    }
    return canvas.toDataURL("image/png").split(",")[1]!;
  })();
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error(error));
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/cursor-sheet.html", route => route.fulfill({
    body: "<!doctype html><html><body style='margin:0'></body></html>", contentType: "text/html"
  }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}cursor-sheet.html`);
  const cursors = await page.evaluate(renderGameCursors, only);
  const sheet = await page.evaluate(drawSheet, cursors);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "cursor-contact-sheet.png"), Buffer.from(sheet, "base64"));
  for (const [name, { hotspot }] of Object.entries(cursors)) console.log(name, hotspot.join(" "));
} finally { await browser.close(); await server.close(); }

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { GPU_PROFILE } from "../../tools/bench/chrome";
import { UI_TEST_URL } from "../fixtures/server";

/**
 * Committed map editor icons (`assets/editor-icons/*.webp`, lossless, from
 * `npm run editor-icons`) against a fresh render of `editor-icons.html`. Both are WebP, which
 * `toHaveScreenshot` cannot read, so the page decodes both and counts differing pixels itself.
 */
const FOLDER = resolve(import.meta.dirname, "../../assets/editor-icons");
/** Per-channel difference that counts a pixel as changed, and the share of changed pixels allowed. */
const CHANNEL_TOLERANCE = 8;
const MAX_CHANGED_RATIO = 0.005;
const committedIcons = () => readdirSync(FOLDER).filter(file => file.endsWith(".webp"))
  .map(file => file.replace(/\.webp$/, ""));

test.skip(GPU_PROFILE !== "gpu", "icon baselines exist for the NVIDIA profile only");

test("map editor icons match the committed assets", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(`${UI_TEST_URL}editor-icons.html`);
  await page.waitForFunction(() => window.__editorIcons !== undefined, null, { timeout: 200_000 });
  const rendered = await page.evaluate(() => Object.entries(window.__editorIcons!)
    .flatMap(([name, [single, double]]) => [[name, single!], [`${name}@2x`, double!]] as const));
  const committed = committedIcons();
  expect(rendered.map(([name]) => name).sort(), "same icon set as committed").toEqual(committed.sort());
  const results = await page.evaluate(async ({ icons, tolerance }) => {
    const pixels = async (source: string) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      return { data, size: `${image.width}x${image.height}` };
    };
    const compare = async ([name, source]: readonly [string, string]) => {
      const [fresh, stored] = await Promise.all([pixels(source), pixels(`/assets/editor-icons/${name}.webp`)]);
      if (fresh.size !== stored.size) return { changed: 1, name, size: `${fresh.size} vs ${stored.size}` };
      let changed = 0;
      for (let index = 0; index < fresh.data.length; index += 4) {
        for (let channel = 0; channel < 4; channel++) {
          if (Math.abs(fresh.data[index + channel]! - stored.data[index + channel]!) <= tolerance) continue;
          changed++;
          break;
        }
      }
      return { changed: changed / (fresh.data.length / 4), name, size: fresh.size };
    };
    return Promise.all(icons.map(compare));
  }, { icons: rendered, tolerance: CHANNEL_TOLERANCE });
  for (const result of results) {
    const label = `${result.name} (${result.size}) changed pixel share`;
    expect.soft(result.changed, label).toBeLessThanOrEqual(MAX_CHANGED_RATIO);
  }
});

import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { openMainSelection } from "../../fixtures/ui";

/**
 * Wave 2: music player behaviour only the browser shows: real media playback of a local file with
 * keyboard seeking, and the reopen policy (closing only hides the window; the audio service lives
 * outside React). Open / Escape / move are in `lazy-windows.ts`; queue and playback rules are vitest
 * (`music-player-service`, `music-player-panel`).
 */
const SAMPLE_RATE = 8000;

/** Two seconds of a quiet 440 Hz tone as a 16-bit mono WAV. */
const createToneWav = () => {
  const samples = SAMPLE_RATE * 2;
  const bytes = samples * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF");
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(bytes, 40);
  for (let sample = 0; sample < samples; sample++)
    buffer.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 440 / SAMPLE_RATE) * 1000), 44 + sample * 2);
  return buffer;
};

const openPlayer = async (page: Page) => {
  const menu = await openMainSelection(page);
  const opener = menu.getByRole("button", { exact: true, name: "Music player" });
  const player = page.getByRole("dialog", { exact: true, name: "Music player" });
  await opener.click();
  await expect(player.getByRole("listbox", { exact: true, name: "Music playlist" })).toBeVisible();
  return { opener, player };
};

test.describe("music player", () => {
  test("plays a local file, pauses, seeks by keyboard and stops", async ({ game: { page } }) => {
    const { player } = await openPlayer(page);
    const collection = player.getByRole("combobox", { exact: true, name: "Music collection" });
    const initial = await collection.inputValue();
    await player.getByLabel("Choose local music files", { exact: true }).setInputFiles({
      buffer: createToneWav(), mimeType: "audio/wav", name: "smoke-tone.wav"
    });
    await expect(collection).toHaveValue("local");
    await player.getByRole("button", { exact: true, name: "Play" }).click();
    const progress = player.getByRole("slider", { exact: true, name: "Track progress" });
    await expect.poll(async () => Number(await progress.inputValue()), "playback advances").toBeGreaterThan(0.1);
    await player.getByRole("button", { exact: true, name: "Pause" }).click();
    await progress.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    expect(Number(await progress.inputValue()), "keyboard seek").toBeGreaterThan(0);
    await player.getByRole("button", { exact: true, name: "Stop" }).click();
    await expect(progress).toHaveValue("0");
    await collection.selectOption(initial);
  });

  test("keeps its state across close and reopen", async ({ game: { page } }) => {
    const { opener, player } = await openPlayer(page);
    const collection = player.getByRole("combobox", { exact: true, name: "Music collection" });
    const initial = await collection.inputValue();
    await collection.selectOption("all");
    await player.getByRole("button", { exact: true, name: "Close music player window" }).click();
    await expect(player).toBeHidden();
    await opener.click();
    await expect(collection).toHaveValue("all");
    await collection.selectOption(initial);
  });
});

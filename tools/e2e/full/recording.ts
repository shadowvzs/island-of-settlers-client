import { join } from "node:path";
import type { Page } from "playwright-core";

import { closeDevelopment, openDevelopmentAction } from "../../bench/development-ui-helpers";
import { validateExportedRecording } from "./recording-validation";

export const startRecording = async (page: Page) => {
  await (await openDevelopmentAction(page, "Record reproduction")).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".settlement-ui__status")].some((node) =>
        node.textContent?.includes("Recording reproduction.")
      ),
    undefined,
    { timeout: 120_000 }
  );
  await closeDevelopment(page);
  return { startedViaUi: true, scope: "Current island; visits export explicit retained prefixes" };
};
export const exportRecording = async (page: Page, directory: string, name: string) => {
  const filename = `${name.replace(/[^a-zA-Z0-9_-]/g, "-")}.reproduction.json`;
  const target = join(directory, filename);
  const button = await openDevelopmentAction(page, "Export reproduction report");
  const first = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
  await button.click();
  let download = await first, restartedAfterReload = false;
  if (!download) {
    // Import/reload cases end the recording. Start a fresh bounded recording rather than failing
    // the generic evidence case; the returned flag makes the reduced scope explicit.
    restartedAfterReload = true;
    await closeDevelopment(page);
    await startRecording(page);
    const retryButton = await openDevelopmentAction(page, "Export reproduction report");
    const retry = page.waitForEvent("download", { timeout: 60_000 });
    await retryButton.click();
    download = await retry;
  }
  if (!download) throw new Error("Recording export did not provide a download");
  await download.saveAs(target);
  await closeDevelopment(page);
  const replayValidation = await validateExportedRecording(target);
  return { filename, exportedViaUi: true, restartedAfterReload, replayValidation };
};

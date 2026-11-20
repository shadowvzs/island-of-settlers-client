/**
 * Worker nation setting (all four nations): live switch keeps selection and
 * route, the bodies come from the nation's Tripo workers, saved choice.
 *   npx tsx tools/bench/worker-nations.ts
 */
import assert from "node:assert/strict";

import { openWorkerMap, runWorkerBench, WORKER_BENCH_OUTPUT } from "./worker-bench";

await runWorkerBench("map-nations", async ({ errors, page, url }) => {
  await openWorkerMap(page, url, "size=64&seed=42&cache=0&time=day");
  await page.waitForTimeout(1000);
  const initial = await page.evaluate(() => window.__worker!.getState());
  assert.equal(initial.nation, "roman");
  const viewport = await page.locator("#viewport").boundingBox();
  assert(viewport);
  const point = await page.evaluate(() => window.__worker!.project());
  await page.mouse.click(point.x + viewport.x, point.y + viewport.y);
  const destination = await page.evaluate(() => {
    const unit = window.__worker!,
      state = unit.getState();
    for (const [dx, dz] of [
      [4, 0],
      [-4, 0],
      [0, 4],
      [0, -4]
    ]) {
      if (unit.command(state.x + dx!, state.z + dz!)) return unit.getState().target;
    }
    return null;
  });
  assert(destination);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const select = page.getByLabel("Worker nation", { exact: true });
  for (const [label, nation] of [
    ["Viking", "viking"],
    ["Japanese", "japanese"],
    ["Nubian", "nubian"],
    ["Roman", "roman"],
    ["Japanese", "japanese"]
  ]) {
    await select.selectOption({ label });
    await page.waitForFunction((n) => window.__worker!.getState().nation === n, nation, {
      timeout: 60000
    });
    await page.waitForFunction(
      () => !document.querySelector<HTMLSelectElement>('select[name="worker-nation"]')!.disabled
    );
    const state = await page.evaluate(() => window.__worker!.getState());
    assert(state.selected, "changing nation must preserve selection");
    assert(
      state.variant.startsWith(`${nation}-`),
      "the body comes from the nation's Tripo workers"
    );
    if (state.target) assert.deepEqual(state.target, destination);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("island-of-settlers.worker-nation")),
      nation
    );
  }
  await page.screenshot({ path: `${WORKER_BENCH_OUTPUT}/map-nation-settings.png` });
  await page.reload();
  await page.waitForFunction(() => window.__islandReady && window.__worker, undefined, {
    timeout: 120000
  });
  assert.equal((await page.evaluate(() => window.__worker!.getState())).nation, "japanese");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByLabel("Worker nation", { exact: true }).locator("option:checked").textContent(),
    "Japanese"
  );
  assert.deepEqual(errors, []);
  console.log("live nation switches, selection/movement and saved preference passed");
  return {
    destination,
    errors,
    initial,
    nations: ["roman", "viking", "japanese"],
    reloadNation: "japanese"
  };
});

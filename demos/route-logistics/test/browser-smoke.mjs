import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { firefox } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT ?? 5198);
const url = `http://localhost:${port}/`;

const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) break;
    } catch { /* server still starting */ }
    await sleep(100);
  }
  const response = await fetch(url);
  assert.equal(response.ok, true, "demo server did not start");

  browser = await firefox.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, acceptDownloads: true });
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(`PAGEERROR: ${error.message}`));

  await page.goto(url, { waitUntil: "networkidle" });
  assert.match(await page.title(), /flag logistics/i);
  assert.equal(await page.locator("#routes .route").count(), 6);

  await page.locator("#speed").evaluate(element => {
    element.value = "8";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(2200);
  assert.notEqual(await page.locator("#clock").textContent(), "00:00:00", "simulation did not advance");

  await page.locator("#routes [data-add-carrier=\"0\"]").click();
  await page.waitForTimeout(250);
  assert.match(await page.locator("#routes .route").first().innerText(), /2 carriers/);

  await page.locator("#routes .route").first().click();
  await page.waitForTimeout(250);
  assert.match(await page.locator("#selected").innerText(), /Route 1/);

  const before = await page.locator("#seed").textContent();
  await page.locator("#buildingType").selectOption("37");
  await page.locator("#place").click();
  await page.mouse.click(1000, 500);
  await page.waitForTimeout(550);
  assert.match(await page.locator("#message").innerText(), /Added Farm/);
  const after = await page.locator("#seed").textContent();
  assert.notEqual(before, after, "building count did not update");
  assert.match(after, /40 buildings/);

  const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
  await page.locator("#export").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /route-logistics-.*\.json/);

  await page.screenshot({ path: "/tmp/flag-demo-smoke.png" });
  assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
  console.log(JSON.stringify({
    ok: true,
    url,
    clock: await page.locator("#clock").textContent(),
    hud: await page.locator("#hudStats").textContent(),
    buildings: after,
    download: download.suggestedFilename(),
    screenshot: "/tmp/flag-demo-smoke.png"
  }, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

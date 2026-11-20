import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { patchAtmosphereLiveCost } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "verification-portrait-ui-2026-11-05", process.env.RUN ?? "native-a");
assert(!existsSync(resolve(output, "report.json")), "Use a new RUN to preserve previous native evidence");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], missing: string[] = [], rows: unknown[] = [];
let status = "running", failure: string | undefined;
const save = () => writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, failure, errors, missing,
  rows, scope: "Actual game old-hidden desktop portrait restoration and national/gender possession matrix; canonical avatar body; diagnostic side views expose carried/raised " +
    "hand contact while the real eye-level self body remains hidden. No performance or full-E2E claim." }, null, 2));
const portrait = (page: Page) => page.evaluate(async () => {
  const button = document.querySelector<HTMLElement>(".player-hud__portrait")!;
  const computed = getComputedStyle(button), style = button.style;
  const images = [...computed.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1]!);
  const decoded = await Promise.all(images.map(async (source, index) => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 192;
    const context = canvas.getContext("2d")!;
    const column = Number(computed.getPropertyValue("--portrait-column")) || 0;
    const row = Number(computed.getPropertyValue("--portrait-row")) || 0;
    if (index === 0) context.drawImage(image, column * image.width / 10, row * image.height / 12,
      image.width / 10, image.height / 12, 0, 0, 192, 192);
    else context.drawImage(image, 0, 0, 192, 192);
    const pixels = context.getImageData(0, 0, 192, 192).data;
    let opaque = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]! > 0) opaque++;
    return { width: image.width, height: image.height, opaque, source };
  }));
  const box = button.getBoundingClientRect();
  return { backgroundImage: computed.backgroundImage, backgroundPosition: computed.backgroundPosition,
    backgroundSize: computed.backgroundSize, decoded, display: computed.display, hidden: button.closest(".player-hud")!
      .classList.contains("is-portrait-hidden"), opacity: computed.opacity, style: style.cssText,
    vars: Object.fromEntries(["--portrait-column", "--portrait-row", "--portrait-columns", "--portrait-rows", "--portrait-size"]
      .map(name => [name, computed.getPropertyValue(name)])), visibility: computed.visibility,
    width: box.width, height: box.height, hud: document.documentElement.dataset.explorationHud };
});
const sideView = (page: Page, raised: boolean) => page.evaluate(async raised => {
  const debug = (window as any).__atmosphereLiveDebug, subject = (window as any).__spyglassSubject;
  const exploration = (window as any).__exploration;
  const { snapshotAtmosphereFrame } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
  const { rotateAroundUp } = await import(/* @vite-ignore */ String("/src/render-common/camera-state.ts"));
  const { ISO_PITCH } = await import(/* @vite-ignore */ String("/src/render-common/iso-projection.ts"));
  const { Vector3 } = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  if (!debug.frozen) {
    debug.snapshotFrame = snapshotAtmosphereFrame; debug.freeze();
    subject.originalUpdate = exploration.controller.update;
    const held = exploration.controller.frame(); exploration.controller.update = () => held;
  }
  const source = exploration.controller.frame().appearance;
  if (!source) throw new Error("No real possessed appearance frame");
  (window as any).__spyglassLease.update({ ...source, pose: { ...source.pose, mode: "transition" },
    spyglass: raised, visible: true });
  debug.frozenFrame.exploration = null; debug.frozenFrame.workers = []; debug.frozenFrame.buildings = [];
  const yaw = source.pose.yaw - .9, tilt = -.2;
  const direction = rotateAroundUp(Math.SQRT1_2, Math.SQRT1_2, yaw);
  const height = subject.group.position.y + subject.metrics.bodyHeight * .55;
  const horizontal = height / Math.tan(ISO_PITCH + tilt);
  Object.assign(debug.frozenFrame.camera, { centerX: source.pose.x - direction.x * horizontal,
    centerZ: source.pose.z - direction.z * horizontal, zoom: 6, tilt, yaw });
  debug.draw();
  const contact = subject.spyglassAttachment.contacts(), prop = subject.spyglass.root;
  const rightPoint = raised ? contact.rightGrip : new Vector3(0, .065, 0);
  const rightError = prop.localToWorld(rightPoint).distanceTo(contact.right.getWorldPosition(new Vector3()));
  const leftError = prop.localToWorld(contact.leftGrip).distanceTo(contact.left.getWorldPosition(new Vector3()));
  const eyeError = prop.localToWorld(new Vector3(0, -.49, 0)).distanceTo(contact.eye);
  return { raised, rightError, leftError, eyeError, attachmentReason: subject.spyglassAttachment.reason(),
    parent: prop.parent?.name, visible: subject.group.visible, variant: subject.resolution.appearance.variant,
    height: subject.metrics.bodyHeight };
}, raised);
try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(","))
    for (const nation of (process.env.NATIONS ?? "roman,viking,nubian,japanese,chinese,persian,maya,indigenous").split(","))
      for (const gender of ["male", "female"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() === 404) missing.push(response.url()); });
    page.on("console", message => { if (message.type() === "error" && /shader|WebGL|THREE.*Error/i.test(message.text()))
      errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(({ gender, nation }) => {
      (window as any).__name = (value: unknown) => value;
      localStorage.setItem("island-of-settlers.player-avatar-gender", gender);
      localStorage.setItem("island-of-settlers.portrait-hidden", "1");
      localStorage.setItem("island-of-settlers.worker-nation", nation);
    }, { gender, nation });
    await page.route("**/create-three-renderer.ts*", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: patchAtmosphereLiveCost(await response.text()) });
    });
    await page.route("**/exploration-appearance.ts*", async route => {
      const response = await route.fetch();
      const source = await response.text();
      assert(source.includes("return createLease(slot, identity);"));
      await route.fulfill({ response, body: source.replace("return createLease(slot, identity);",
        "window.__spyglassLease=createLease(slot, identity);return window.__spyglassLease;")
        .replace("const explorer = installExplorer(prepared);",
          "const explorer=installExplorer(prepared);window.__spyglassSubject=explorer;") });
    });
    await page.goto(`${url}?quality=${quality}&size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.locator(".player-hud__portrait").waitFor({ state: "attached", timeout: 30000 });
    for (const hidden of [false]) {
      if (hidden) await page.getByRole("button", { exact: true, name: "Hide portrait" }).click();
      const before = await portrait(page);
      const row: any = { quality, nation, gender, legacyHiddenPreference: true, hidden, before };
      rows.push(row); save();
      assert.equal(before.hidden, false, "Desktop restores old hidden preference");
      assert(before.width > 0 && before.height > 0, "Ordinary desktop portrait has a painted area");
      await page.waitForTimeout(350);
      row.animated = await portrait(page);
      assert.notEqual(row.animated.backgroundPosition, before.backgroundPosition, "HUD portrait animates");
      await page.screenshot({ path: resolve(output, `${quality}-${nation}-${gender}-ordinary.png`) });
      assert(before.decoded[0]!.opaque > 0, "Current sprite tile must decode nonempty");
      await page.locator("[data-exploration-entry]").click();
      await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null,
        { timeout: 180_000 });
      const possessed = await portrait(page);
      row.possessed = possessed; save();
      assert(possessed.width > 0 && possessed.height > 0, "Possessed portrait needs a nonzero painted area");
      await page.screenshot({ path: resolve(output, `${quality}-${nation}-${gender}-possessed.png`) });
      const poses: unknown[] = [];
      if (!hidden) for (const raised of [false, true]) {
        const result = await sideView(page, raised);
        assert.equal(result.parent, "socket_hand_R"); assert.equal(result.attachmentReason, null);
        assert(result.rightError < 1e-7);
        if (raised) { assert(result.leftError < .005); assert(result.eyeError < .02); }
        poses.push(result);
        await page.screenshot({ path: resolve(output, `${quality}-${nation}-${gender}-${raised ? "raised" : "carried"}.png`) });
      }
      row.poses = poses; save();
      await page.evaluate(() => {
        const subject = (window as any).__spyglassSubject, debug = (window as any).__atmosphereLiveDebug;
        const controller = (window as any).__exploration.controller;
        if (subject.originalUpdate) controller.update = subject.originalUpdate;
        debug.frozen = false;
        controller.forceExit("session-replacement");
      });
      await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "idle");
    }
    await context.close();
    console.log(`Portrait and spyglass ${quality}/${nation}/${gender}: passed`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(missing, []); status = "passed"; save();
} catch (error) { status = "failed"; failure = String(error); save(); throw error; }
finally { await browser.close(); await server.close(); }
console.log(`Exploration spyglass native review: ${status}`);

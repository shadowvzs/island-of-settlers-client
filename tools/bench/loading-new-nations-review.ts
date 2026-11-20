import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/** Hold the game graph while reviewing the real critical loader, including responsive water masks. */
const output = process.env.OUTPUT ?? "/tmp/codex-loading-nations/final-review";
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const nation of ["chinese", "persian", "maya", "indigenous"]) {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      const size = viewport.width === 1280 ? "desktop" : "mobile";
      const record = false;
      const page = await browser.newPage({ viewport,
        recordVideo: record ? { dir: output, size: viewport } : undefined });
      const errors: string[] = [], images: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        if (request.resourceType() === "image" && /island-voyage.*\.webp/.test(request.url()))
          images.push(request.url());
      });
      await page.addInitScript(nation => localStorage.setItem("island-of-settlers.loading-nation", nation), nation);
      await page.route("**/src/app/main.ts", route => route.fulfill({ contentType: "text/javascript", body: "" }));
      await page.goto(url);
      await page.waitForFunction(nation => {
        const image = document.querySelector<HTMLImageElement>(".loading-screen__image");
        const water = document.querySelector<HTMLImageElement>(".loading-screen__sea-image");
        const foreground = document.querySelector<HTMLImageElement>(".loading-screen__foreground-image");
        return image?.dataset.nation === nation && image.complete && image.naturalWidth > 0 &&
          water?.complete && water.naturalWidth > 0 && foreground?.complete && foreground.naturalWidth > 0;
      }, nation);
      await page.locator(".loading-screen__atmosphere img").evaluateAll(images =>
        Promise.all(images.map(image => (image as HTMLImageElement).decode())));
      if (record) await page.waitForTimeout(6000);
      const phases: unknown[] = [];
      let islandPatch: Buffer | undefined;
      let previousArt: string | undefined;
      let previousForeground: string | undefined;
      let previousWater: string | undefined;
      for (const time of [0, 4000]) {
        const state = await page.evaluate(time => {
          document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time; });
          const art = document.querySelector<HTMLElement>(".loading-screen__art")!;
          const image = document.querySelector<HTMLImageElement>(".loading-screen__image")!;
          const sea = document.querySelector<HTMLElement>(".loading-screen__sea")!;
          const water = document.querySelector<HTMLImageElement>(".loading-screen__sea-image")!;
          const foreground = document.querySelector<HTMLElement>(".loading-screen__foreground")!;
          const foregroundImage = document.querySelector<HTMLImageElement>(".loading-screen__foreground-image")!;
          const bounds = image.getBoundingClientRect();
          return { aspect: Number(art.style.getPropertyValue("--voyage-aspect")), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, art: getComputedStyle(art).transform, water: getComputedStyle(water).transform,
            atmosphere: [...document.querySelectorAll<HTMLImageElement>(".loading-screen__atmosphere img")]
              .map(image => ({ animation: getComputedStyle(image).animationName,
                transform: getComputedStyle(image).transform, source: image.currentSrc,
                naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })),
            foreground: getComputedStyle(foreground).transform, foregroundSource: foregroundImage.currentSrc,
            mask: getComputedStyle(sea).maskImage, source: image.currentSrc, waterSource: water.currentSrc,
            coversViewport: bounds.left <= 0 && bounds.top <= 0 &&
              bounds.right >= innerWidth && bounds.bottom >= innerHeight };
        }, time);
        assert(state.coversViewport);
        assert(Math.abs(state.aspect - state.naturalWidth / state.naturalHeight) < 1e-10, `${nation}: image aspect mismatch`);
        assert(state.source.includes(`island-voyage-${nation}`));
        assert.equal(state.source, state.waterSource);
        assert.equal(state.source, state.foregroundSource);
        assert.notEqual(state.mask, "none");
        assert.equal(state.atmosphere.length, nation === "viking" ? 6 : 2);
        assert(state.atmosphere.every(sprite => sprite.naturalWidth <= 512 && sprite.naturalHeight <= 192));
        phases.push(state);
        const patch = await page.screenshot({ clip: { x: viewport.width * .75, y: viewport.height * .12,
          width: viewport.width * .20, height: viewport.height * .18 } });
        if (islandPatch) {

          assert.equal(state.art, previousArt);
          assert.notEqual(state.foreground, previousForeground);
          assert.notEqual(state.water, previousWater);
          assert.notDeepEqual((phases[0] as typeof state).atmosphere, state.atmosphere,
            "Actual lightweight atmosphere transforms must change");
        }
        islandPatch = patch; previousArt = state.art;
        previousForeground = state.foreground; previousWater = state.water;
        await page.screenshot({ path: resolve(output, `${nation}-${size}-${time}.png`) });
      }
      assert.notDeepEqual(phases[0], phases[1]);
      assert.equal(images.length, 1, "the sea layer must reuse the poster's image request");
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await page.evaluate(() => ({
        art: getComputedStyle(document.querySelector(".loading-screen__art")!).animationName,
        atmosphere: getComputedStyle(document.querySelector(".loading-screen__atmosphere")!).display,
        foreground: getComputedStyle(document.querySelector(".loading-screen__foreground")!).display,
        sea: getComputedStyle(document.querySelector(".loading-screen__sea")!).display,
        water: getComputedStyle(document.querySelector(".loading-screen__sea-image")!).animationName
      }));
      assert.deepEqual(reduced, { art: "none", atmosphere: "none", foreground: "none", sea: "none", water: "none" });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => document.querySelector(".loading-screen")!.classList.add("is-failed"));
      const paused = await page.evaluate(() => [".loading-screen__foreground", ".loading-screen__sea-image"]
        .map(selector => getComputedStyle(document.querySelector(selector)!).animationPlayState));
      assert.deepEqual(paused, ["paused", "paused"]);
      const atmospherePaused = await page.locator(".loading-screen__atmosphere img").evaluateAll(images =>
        images.every(image => getComputedStyle(image).animationPlayState === "paused"));
      assert(atmospherePaused);
      assert.deepEqual(errors, []);
      reports.push({ nation, size, errors, images, phases, paused, reduced });
      const video = page.video();
      await page.close();
      if (record) await video!.saveAs(resolve(output, "voyage-preview.webm"));
    }
  }
  // Repeated switches exercise stale decode protection, bounded sprite nodes and page memory.
  const page = await browser.newPage();
  const pageErrors: string[] = [], failures: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("crash", () => pageErrors.push("page crashed"));
  page.on("requestfailed", request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.route("**/src/app/main.ts", route => route.fulfill({ contentType: "text/javascript", body: "" }));
  await page.goto(url);
  const cdp = await page.context().newCDPSession(page);
  const memories: unknown[] = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const nation of ["chinese", "persian", "maya", "indigenous"]) {
      await page.evaluate(async nation => {
        const { setLoadingNation } = await import(/* @vite-ignore */ String("/src/app/loading-illustrations.ts"));
        const root = document.getElementById("loading-screen")!;
        setLoadingNation(root, "roman"); setLoadingNation(root, nation);
      }, nation);
      await page.waitForFunction(nation => {
        const art = document.querySelector<HTMLElement>(".loading-screen__art");
        const images = [...document.querySelectorAll<HTMLImageElement>(
          ".loading-screen__image, .loading-screen__sea-image, .loading-screen__foreground-image")];
        return art?.dataset.nation === nation && images.length === 3 &&
          images.every(image => image.complete && image.naturalWidth > 0 && image.currentSrc === images[0]!.currentSrc) &&
          images[0]!.currentSrc.includes(`island-voyage-${nation}`);
      }, nation);
      assert.equal(await page.locator(".loading-screen__atmosphere").count(), 1);
      assert.equal(await page.locator(".loading-screen__atmosphere img").count(), 2);
    }
    await cdp.send("HeapProfiler.collectGarbage");
    memories.push({ heap: await cdp.send("Runtime.getHeapUsage"), dom: await cdp.send("Memory.getDOMCounters") });
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failures, []);
  reports.push({ nationSwitchRace: "passed", cycles: 4, memories, pageErrors, failures });
  await page.close();
  console.log("All four new nations passed desktop/mobile motion, masking, image reuse and reduced-motion checks.");
} finally {
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  await browser.close(); await server.close();
}

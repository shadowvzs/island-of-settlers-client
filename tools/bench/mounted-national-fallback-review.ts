import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/project-reviews/mounted-national-fallback-current");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } }), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/mounted-fallback", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0'>" }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}mounted-fallback`);
    const result = await page.evaluate(async detailed => {
      const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { createThreeMounts } = await import(/* @vite-ignore */ String("/src/renderers/three/three-mounts.ts"));
      const { createWorkerTextureLoader } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
      const { NATION_RIDERS } = await import(/* @vite-ignore */ String("/src/render-common/mounts/nation-riders.ts"));
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight); document.body.append(renderer.domElement);
      const textures = createWorkerTextureLoader(renderer), mounts = await createThreeMounts(textures, [], detailed);
      mounts.scene.background = new T.Color("#b9c6ac");
      const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
      const camera = new T.PerspectiveCamera(30, innerWidth / innerHeight, .05, 100);
      const captures: { name: string; png: string }[] = [], entries = [];
      let actorId = 0;
      for (const nation of ["chinese", "persian", "maya", "indigenous"]) for (const commander of [false, true]) {
        const frame = { actorId: ++actorId, attackProgress: null, auraActive: false, clip: "idle", clipTime: .4, coat: "bay",
          commander, faction: 0, heading: 0, nation, rider: NATION_RIDERS[nation], selected: false,
          turnRate: 0, x: 0, y: 0, z: 0 };
        await mounts.prepare([frame], environment);
        let insignia = 0;
        mounts.scene.traverseVisible((object: any) => { if (object.name === "commander_insignia") insignia++; });
        if (insignia !== Number(commander)) throw new Error(`${nation}: wrong mounted rank instance`);
        for (const [view, eye] of [["front", [2.5, 1.9, 4]], ["side", [4, 1.8, .3]]] as const) {
          camera.position.set(...eye); camera.lookAt(0, .95, 0); renderer.render(mounts.scene, camera);
          captures.push({ name: `${nation}-${commander ? "commander" : "cavalry"}-${view}`,
            png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
        }
        entries.push({ nation: frame.nation, rider: frame.rider, commander, insignia, draws: renderer.info.render.calls });
      }
      mounts.dispose(); textures.dispose(); renderer.dispose(); return { captures, entries };
    }, detailed);
    assert.deepEqual(errors, []);
    for (const { name, png } of result.captures)
      writeFileSync(resolve(output, `${name}-${detailed ? "high" : "minimal"}.png`), Buffer.from(png, "base64"));
    reports.push({ quality: detailed ? "high" : "minimal", entries: result.entries, errors });
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await server.close(); }

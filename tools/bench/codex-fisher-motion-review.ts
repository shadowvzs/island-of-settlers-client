import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const nation = process.argv[2] ?? "roman", variant = process.argv[3] ?? "roman-man-grey";
const yard = process.argv.includes("--yard");
const output = resolve(process.argv[4] ?? `/tmp/codex-fisher-boat/motion/${variant}-${yard ? "yard" : "ground"}`);
const frames = resolve(output, "frames"); mkdirSync(frames, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 2400, height: 800 } });
  await page.addInitScript("window.__name=value=>value;");
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${url}building-showcase.html?building=0&quality=minimal&sample=1`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady));
  await page.evaluate(async ({ nation, variant, workerModule, yard }) => {
    const preview = (window as any).__buildingPreview;
    preview.renderer.setAnimationLoop(null); preview.model().root.visible = false;
    const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
    const workers = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
    const props = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker-prop.ts"));
    const packs = await import(/* @vite-ignore */ workerModule);
    const assets = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-assets.ts"));
    const dimensions = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-dimensions.ts"));
    const transfer = await import(/* @vite-ignore */ String("/src/renderers/three/worker-boat-transfer.ts"));
    const textures = workers.createWorkerTextureLoader(preview.renderer);
    const pack = new packs.ThreeWorkerPack(`${assets.WORKER_ASSET_BASE}tripo/`, textures, false);
    const worker = await pack.load(nation, variant); worker.root.scale.setScalar(dimensions.WORKER_SCALE);
    preview.scene.add(worker.root);
    const poser = workers.createWorkerPoser(worker), held = props.createWorkerProp(pack, worker, true);
    const cameras = [[0, .7, 3], [2, 1.6, 3], [0, .7, -3]].map(position => {
      const camera = new three.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, .01, 20);
      camera.position.set(...position); camera.lookAt(0, .65, 0); return camera;
    });
    preview.renderer.setPixelRatio(1); preview.renderer.setSize(2400, 800, false);
    preview.renderer.domElement.style.cssText = "position:fixed;inset:0;width:2400px;height:800px;z-index:99999";
    (window as any).__fisherMotion = (phase: number) => {
      const frame: any = { nation, variant, x: 0, y: 0, z: 0, heading: 0, selected: false,
        action: "boat_lift", carryingWare: "boat", animationTime: Math.min(1.19999, phase * 1.2),
        gaitPhase: .25, runBlend: 0, target: null, workerJob: "Fisher" };
      if (yard) {
        frame.fisherBoatYard = { x: .725, y: 0, z: .1, yaw: -Math.PI / 2 };
        frame.heading = transfer.yardBoatWorkerHeading(frame.fisherBoatYard.yaw, phase);
      }
      worker.root.rotation.y = frame.heading;
      poser(frame); held.update(frame);
      preview.renderer.setScissorTest(true);
      for (let index = 0; index < 3; index++) {
        preview.renderer.setViewport(index * 800, 0, 800, 800); preview.renderer.setScissor(index * 800, 0, 800, 800);
        preview.renderer.render(preview.scene, cameras[index]);
      }
      preview.renderer.setScissorTest(false);
    };
    (window as any).__fisherMotion(0);
  }, { nation, variant, yard, workerModule: `/@fs${resolve("../island-of-settlers-worker-generation/src/game-three-worker.ts")}` });
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas").first();
  // 0.2s hold + true 1.2s lift + 0.5s hold, encoded at60fps.
  for (let index = 0; index < 114; index++) {
    const phase = Math.max(0, Math.min(1, (index - 12) / 72));
    await page.evaluate(phase => (window as any).__fisherMotion(phase), phase);
    await canvas.screenshot({ path: resolve(frames, `frame-${String(index).padStart(4, "0")}.png`) });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "60", "-i", resolve(frames, "frame-%04d.png"),
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", resolve(output, "cycle.mp4")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "2", "-i", resolve(output, "cycle.mp4"),
    "-c", "copy", "-movflags", "+faststart", resolve(output, "comparison.mp4")]);
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ nation, variant, yard, fps: 60, liftSeconds: 1.2, cycles: 3, errors }, null, 2));
  rmSync(frames, { recursive: true });
  console.log(`Saved true-time motion ${output}/comparison.mp4`);
} finally { await browser.close(); await server.close(); }

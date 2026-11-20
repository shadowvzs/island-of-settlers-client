import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("assets/worker-icons");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).__name = (value: unknown) => value;
  });
  await page.goto(`${url}building-showcase.html?building=0&quality=high&sample=1`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady));
  const results = await page.evaluate(async () => {
    const three = await import(
      /* @vite-ignore */ String("/node_modules/three/build/three.module.js")
    );
    const workers = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
    const props = await import(
      /* @vite-ignore */ String("/src/renderers/three/three-worker-prop.ts")
    );
    const assets = await import(
      /* @vite-ignore */ String("/src/render-common/workers/worker-assets.ts")
    );
    const packModule = await import(
      /* @vite-ignore */ String(
        "/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts"
      )
    );
    const preview = (window as any).__buildingPreview;
    preview.renderer.setAnimationLoop(null);
    const renderer = new three.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    });
    renderer.setSize(256, 256);
    renderer.setPixelRatio(1);
    renderer.toneMapping = three.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const textureLoader = workers.createWorkerTextureLoader(renderer);
    const pack = new packModule.ThreeWorkerPack(
      new URL(assets.WORKER_ASSET_BASE + "tripo/", location.href).href,
      textureLoader
    );
    const manifest = await (await fetch(assets.WORKER_ASSET_BASE + "tripo/manifest.json")).json();
    const bodies = manifest.workers.filter((entry: any) => entry.nation === "roman");
    const jobs = [
      ["carrier", "Carrier", undefined],
      ["builder", "Builder", "hammer"],
      ["woodcutter", "Woodcutter", "axe"],
      ["fisher", "Fisher", "fishingRod"],
      ["farmer", "Farmer", "scythe"],
      ["geologist", "Geologist", "hammer"]
    ];
    const scene = new three.Scene();
    scene.add(new three.HemisphereLight("#fff1d4", "#657276", 3));
    const sun = new three.DirectionalLight("#fff8e7", 3);
    sun.position.set(-3, 5, 7);
    scene.add(sun);
    const camera = new three.PerspectiveCamera(30, 1, 0.01, 20);
    const results = [];
    for (let index = 0; index < jobs.length; index++) {
      const [name, job, tool] = jobs[index]!;
      const appearance = bodies[index % bodies.length];
      const worker = await pack.load("roman", appearance.variant);
      const poser = workers.createWorkerPoser(worker);
      const held = props.createWorkerProp(pack, worker, true);
      const frame = {
        action: "idle_breathe",
        animationTime: 0.3,
        gaitPhase: 0,
        runBlend: 0,
        heading: -0.2,
        workerJob: job,
        workerTool: tool
      };
      scene.add(worker.root);
      worker.root.rotation.y = -0.22;
      poser(frame);
      worker.root.updateMatrixWorld(true);
      const bodyBounds = new three.Box3().setFromObject(worker.root);
      for (let step = 0; step < 12; step++) {
        poser(frame);
        held.update(frame);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      worker.root.updateMatrixWorld(true);
      const height = bodyBounds.max.y - bodyBounds.min.y;
      const center = bodyBounds.getCenter(new three.Vector3());
      camera.position.set(
        center.x + height * 0.2,
        center.y + height * 0.09,
        center.z + height * 2.35
      );
      camera.lookAt(center.x, center.y, center.z);
      renderer.render(scene, camera);
      results.push({
        name,
        job,
        tool,
        variant: appearance.variant,
        png: renderer.domElement.toDataURL("image/png").split(",")[1]
      });
      held.dispose();
      worker.dispose();
    }
    pack.dispose();
    textureLoader.dispose();
    renderer.dispose();
    return results;
  });
  if (errors.length) throw new Error(errors.join("\n"));
  for (const entry of results)
    writeFileSync(resolve(output, `${entry.name}.png`), Buffer.from(entry.png!, "base64"));
  writeFileSync(
    resolve(output, "render-manifest.json"),
    JSON.stringify(
      results.map(({ png, ...entry }) => entry),
      null,
      2
    )
  );
  console.log(JSON.stringify({ output, portraits: results.length, errors }));
} finally {
  await browser.close();
  await server.close();
}

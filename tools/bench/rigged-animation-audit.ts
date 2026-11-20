import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
const output = resolve("../resources/settlement-previews/rigged-animation-audit"); mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 2400, height: 1800 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/animation-audit.html", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0;background:#a7aea6'></body>" }));
    await page.goto(`${url}animation-audit.html`);
    const variants = await page.evaluate(async quality => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const three = await imp("/node_modules/three/build/three.module.js");
      const { ThreeWorkerPack } = await imp("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts");
      const { ThreeArmourPack } = await imp("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-armour.ts");
      const { createWorkerPoser, createWorkerTextureLoader } = await imp("/src/renderers/three/three-worker.ts");
      const renderer = new three.WebGLRenderer({ antialias: quality === "high" });
      renderer.setSize(innerWidth, innerHeight); renderer.setClearColor("#a7aea6"); document.body.append(renderer.domElement);
      const scene = new three.Scene(), camera = new three.OrthographicCamera(-4.6, 4.6, 3.45, -3.45, .1, 100);
      camera.position.set(0, 12, 9); camera.lookAt(0, .4, -4);
      scene.add(new three.HemisphereLight(0xffffff, 0x6b745c, 2));
      const sun = new three.DirectionalLight(0xffedd5, 2.5); sun.position.set(-4, 9, 8); scene.add(sun);
      const loader = createWorkerTextureLoader(renderer), pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, loader);
      const armour = new ThreeArmourPack(new URL("workers/armour/", location.href).href, pack);
      const manifest = await fetch(new URL("workers/tripo/manifest.json", location.href)).then(response => response.json());
      let actors: any[] = [];
      const labels = document.createElement("div"); labels.style.cssText = "position:absolute;inset:0;pointer-events:none;color:#172014;font:15px system-ui";
      document.body.append(labels);
      (window as any).__animationAudit = {
        setup: async (variant: string) => {
          for (const actor of actors) actor.worker.dispose(); actors = []; labels.replaceChildren();
          const [body, rank] = variant.split("--");
          const entry = manifest.workers.find((worker: any) => worker.variant === body);
          const load = () => rank ? armour.loadSoldier(entry.nation, body, rank) : pack.load(entry.nation, body);
          const first = await load();
          const clips = first.clips.map((clip: any) => clip.name);
          for (let index = 0; index < clips.length; index++) {
            const worker = index === 0 ? first : await load();
            const group = new three.Group(); group.position.set((index % 6 - 2.5) * 1.25, 0, -Math.floor(index / 6) * 1.6);
            group.add(worker.root); scene.add(group); worker.root.scale.setScalar(1.0625 / 1.16);
            const label = document.createElement("span"); label.textContent = clips[index]; label.style.position = "absolute";
            labels.append(label); actors.push({ worker, group, label, pose: createWorkerPoser(worker), clip: clips[index] });
          }
          return clips;
        },
        sample: (phase: number, normal: boolean) => {
          camera.position.set(0, 12, 9); camera.lookAt(0, .4, -4);
          camera.zoom = normal ? .72 : 1; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
          const metrics: unknown[] = [];
          for (const actor of actors) {
            actor.worker.setLod?.(quality === "minimal" || normal ? 1 : 0);
            const clip = actor.worker.clips.find((clip: any) => clip.name === actor.clip);
            actor.pose({ nation: actor.worker.entry.nation, variant: actor.worker.entry.variant, x: 0, y: 0, z: 0,
              heading: 0, visible: true, selected: false, action: actor.clip, animationTime: clip.duration * phase,
              gaitPhase: phase, runBlend: actor.clip === "run" ? 1 : 0, target: null });
            actor.worker.root.updateMatrixWorld(true);
            let finite = true, bones = 0;
            actor.worker.root.traverse((object: any) => { if (object.isSkinnedMesh) object.computeBoundingBox();
              if (object.isBone) { bones++;
              finite &&= object.matrixWorld.elements.every(Number.isFinite); } });
            const box = new three.Box3().setFromObject(actor.worker.root), size = box.getSize(new three.Vector3());
            const point = actor.group.position.clone().add(new three.Vector3(0, -.1, 0)).project(camera);
            actor.label.style.left = `${(point.x + 1) * innerWidth / 2 - 45}px`;
            actor.label.style.top = `${(1 - point.y) * innerHeight / 2}px`;
            metrics.push({ clip: actor.clip, finite, bones, size: size.toArray() });
          }
          renderer.render(scene, camera); return metrics;
        },
        dispose: () => { for (const actor of actors) actor.worker.dispose(); pack.dispose(); loader.dispose(); renderer.dispose(); }
      };
      return manifest.workers.flatMap((worker: any) => [worker.variant,
        ...["recruit", "soldier", "centurion"].map(rank => `${worker.variant}--${rank}`)]);
    }, quality);
    for (const variant of variants) {
      const clips = await page.evaluate(variant => (window as any).__animationAudit.setup(variant), variant);
      for (const phase of [0, .5, .95]) {
        const metrics = await page.evaluate(phase => (window as any).__animationAudit.sample(phase, false), phase);
        assert(metrics.every((metric: any) => metric.finite && metric.bones > 40 && metric.size.every(Number.isFinite)));
        await page.screenshot({ path: resolve(output, `${quality}-${variant}-${phase}.png`) });
        reports.push({ quality, variant, phase, clips, metrics });
      }
      await page.evaluate(() => (window as any).__animationAudit.sample(.5, true));
      await page.screenshot({ path: resolve(output, `${quality}-${variant}-normal.png`) });
      console.log(`${quality}: ${variant}, ${clips.length} clips, three phases + gameplay distance`);
    }
    assert.deepEqual(errors, []); await page.evaluate(() => (window as any).__animationAudit.dispose()); await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }

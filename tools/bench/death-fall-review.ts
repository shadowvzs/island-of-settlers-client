import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Native review of a soldier's death on High and Minimal: a foot soldier falling forward and a
 * rider going down with his horse, each under its death smoke, at several moments of the effect.
 * Run: `npx tsx tools/bench/death-fall-review.ts` (OUTPUT=folder for the screenshots).
 */
const output = resolve(process.env.OUTPUT ?? "../resources/settlement-previews/death-fall");
mkdirSync(output, { recursive: true });
const AGES = [0, .3, .6, .8, 1.4, 2.2];
/** The sibling worker repository as Vite serves it (a worktree reaches it through a link). */
const WORKERS = `/@fs${resolve("../island-of-settlers-worker-generation/src")}`;
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/death-review.html", route => route.fulfill({ contentType: "text/html",
      body: "<!doctype html><body style='margin:0'>" }));
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}death-review.html`);
    const captures = await page.evaluate(async ({ ages, quality, workers }) => {
      const detailed = quality === "high";
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { ThreeWorkerPack } = await import(/* @vite-ignore */ `${workers}/game-three-worker.ts`);
      const { ThreeArmourPack } = await import(/* @vite-ignore */ `${workers}/game-three-armour.ts`);
      const { createWorkerPoser, createWorkerTextureLoader } = await import(
        /* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const { createThreeMounts } = await import(/* @vite-ignore */ String("/src/renderers/three/three-mounts.ts"));
      const { createThreeCombatEffects } = await import(
        /* @vite-ignore */ String("/src/renderers/three/settlement/three-combat-effects.ts"));
      const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
      const { WORKER_SCALE } = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-dimensions.ts"));
      const renderer = new three.WebGLRenderer({ antialias: detailed, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight); renderer.toneMapping = three.ACESFilmicToneMapping;
      renderer.autoClear = false;
      document.body.append(renderer.domElement);
      const scene = new three.Scene(); scene.background = new three.Color(0x8fa070);
      scene.add(new three.HemisphereLight(0xfff1db, 0x667854, 2.4));
      const sun = new three.DirectionalLight(0xfff1db, 3); sun.position.set(-4, 8, 6); scene.add(sun);
      const floor = new three.Mesh(new three.PlaneGeometry(30, 30), new three.MeshStandardMaterial({ color: 0x7d8a52 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
      const camera = new three.PerspectiveCamera(35, innerWidth / innerHeight, .01, 100);
      camera.position.set(3.4, 4.2, 6.4); camera.lookAt(1.4, .5, 0);
      const textures = createWorkerTextureLoader(renderer);
      const pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, textures);
      const armour = new ThreeArmourPack(new URL("workers/armour/", location.href).href, pack);
      const manifest = await fetch("workers/armour/manifest.json").then(response => response.json());
      const variant = manifest.sets.find((set: any) => set.nation === "roman").bodies[0].id;
      const soldier = await armour.loadSoldier("roman", variant, "soldier");
      soldier.root.scale.setScalar(WORKER_SCALE); scene.add(soldier.root);
      const pose = createWorkerPoser(soldier);
      const mounts = await createThreeMounts(textures, [], detailed);
      const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .8 }, 12, 0);
      const effects = createThreeCombatEffects(detailed); scene.add(effects.root);
      // As in the game: the smoke pass draws after the soldiers and horses.
      const smokeScene = new three.Scene().add(effects.smoke);
      const foot = { id: 1, x: 0, y: 0, z: 0, yaw: .5 }, rider = { id: 2, x: 2.6, y: 0, z: -.4, yaw: -.4 };
      const soldierFrame: any = { nation: "roman", variant, x: foot.x, y: 0, z: foot.z, heading: foot.yaw,
        action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0, selected: false, target: null,
        workerJob: "Soldier", carryingWare: null, visible: true };
      const mountFrame = (fall: number) => ({ actorId: 2, rider: "roman-man-white", coat: "bay", nation: "roman",
        faction: 1, x: rider.x, y: 0, z: rider.z, heading: rider.yaw, clip: "idle", clipTime: 0, turnRate: 0,
        attackProgress: null, fall });
      mounts.update([mountFrame(0)], environment);
      await new Promise(done => setTimeout(done, 1200));
      const images = [];
      for (const age of ages) {
        const t = Math.min(1, age / .8), falling = age < .8;
        soldierFrame.lean = 1.45 * t * t; soldier.root.visible = falling;
        for (let retry = 0; retry < 3; retry++) pose(soldierFrame);
        soldier.root.rotation.set(soldierFrame.lean, foot.yaw, 0, "YXZ");
        mounts.update(falling ? [mountFrame(t)] : [], environment);
        effects.update([], [{ ...foot, age, faction: 0, mounted: false },
          { ...rider, age, faction: 1, mounted: true }], [.2, .35, .85]);
        renderer.clear(); renderer.render(scene, camera); mounts.render(renderer, camera);
        renderer.render(smokeScene, camera);
        images.push({ name: `${quality}-${age.toFixed(1)}s`, png: renderer.domElement.toDataURL().split(",")[1] });
      }
      effects.update([], []);
      // The falls alone, without their smoke, to check the poses.
      for (const t of [.5, 1]) {
        soldierFrame.lean = 1.45 * t * t; soldier.root.visible = true;
        for (let retry = 0; retry < 3; retry++) pose(soldierFrame);
        soldier.root.rotation.set(soldierFrame.lean, foot.yaw, 0, "YXZ");
        mounts.update([mountFrame(t)], environment);
        renderer.clear(); renderer.render(scene, camera); mounts.render(renderer, camera);
        images.push({ name: `${quality}-fall-only-${t.toFixed(1)}`, png: renderer.domElement.toDataURL().split(",")[1] });
      }
      const leftovers = effects.root.children.length + effects.smoke.children.length;
      mounts.dispose(); effects.dispose(); renderer.dispose();
      return { images, leftovers };
    }, { ages: AGES, quality, workers: WORKERS });
    for (const image of captures.images) writeFileSync(resolve(output, `${image.name}.png`), Buffer.from(image.png, "base64"));
    assert.equal(captures.leftovers, 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`death fall review written to ${output}`);
} finally { await browser.close(); await server.close(); }

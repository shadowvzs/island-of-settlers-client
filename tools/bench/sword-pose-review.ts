import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Melee moves: every sword and axe move, guard and block. The drawn blade must point along the
 * intended weapon direction (worker-melee-moves.ts); reports the angle error per pose.
 */
const output = resolve("../resources/settlement-previews/sword-pose");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/sword.html", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0'>" }));
  await page.addInitScript("window.__name=value=>value;");
  await page.goto(`${url}sword.html`);
  const report = await page.evaluate(async () => {
    const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
    const { ThreeWorkerPack } = await import(/* @vite-ignore */ String(
      "/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts"));
    const { ThreeArmourPack } = await import(/* @vite-ignore */ String(
      "/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-armour.ts"));
    const { createWorkerPoser, createWorkerTextureLoader } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
    const { createWorkerProp } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker-prop.ts"));
    const { WORKER_SCALE } = await import(/* @vite-ignore */ String("/src/render-common/workers/worker-dimensions.ts"));
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight); renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(0xb7bdab);
    scene.add(new T.HemisphereLight(0xfff1db, 0x667854, 2.4));
    const sun = new T.DirectionalLight(0xfff1db, 3); sun.position.set(-4, 8, 6); scene.add(sun);
    const camera = new T.PerspectiveCamera(35, innerWidth / innerHeight, .01, 100);
    const pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, createWorkerTextureLoader(renderer));
    const armour = new ThreeArmourPack(new URL("workers/armour/", location.href).href, pack);
    const manifest = await fetch("workers/armour/manifest.json").then(response => response.json());
    const captures: { name: string; png: string }[] = [], blades: unknown[] = [];
    for (const nation of ["roman", "viking"]) {
      const variant = manifest.sets.find((set: any) => set.nation === nation).bodies[0].id;
      const worker = await armour.loadSoldier(nation, variant, "soldier");
      worker.root.scale.setScalar(WORKER_SCALE); scene.add(worker.root);
      const pose = createWorkerPoser(worker), props = createWorkerProp(pack, worker, true);
      const frame: any = { nation, variant, x: 0, y: 0, z: 0, heading: 0, action: "idle_breathe", animationTime: 0,
        gaitPhase: 0, runBlend: 0, selected: false, target: null, workerJob: "Soldier", carryingWare: null,
        visible: true, workerTool: "sword" };
      const { meleePose, weaponDirection } = await import(/* @vite-ignore */ String("/src/renderers/three/worker-melee-moves.ts"));
      const cases: { type: string; variant: number; progress: number | null; defending: boolean }[] = [];
      const swordPoseLabel = (entry: typeof cases[number]) => {
        if (entry.defending) return "block";
        return entry.progress === null ? "guard" : `v${entry.variant}-${entry.progress}`;
      };
      for (const [type, variants] of [["shield", 3], ["heavy", 2]] as const) {
        cases.push({ defending: false, progress: null, type, variant: 0 }, { defending: true, progress: null, type, variant: 0 });
        for (let variant = 0; variant < variants; variant++)
          for (const progress of [.35, .55, .7]) cases.push({ defending: false, progress, type, variant });
      }
      for (const entry of cases) {
        frame.workerTool = entry.type === "heavy" ? "axe" : "sword";
        frame.combat = { attackProgress: entry.progress, defending: entry.defending, faction: 0, type: entry.type,
          variant: entry.variant };
        for (let retry = 0; retry < 5; retry++) { pose(frame); props.update(frame); await new Promise(r => setTimeout(r, 15)); }
        worker.root.updateMatrixWorld(true);
        let weapon: any;
        worker.root.traverse((o: any) => { if (!weapon && o.visible && /military_(sword|axe)|^(sword|axe)$/i.test(o.name)) weapon = o; });
        const hand = worker.root.getObjectByName("socket_hand_R").getWorldPosition(new T.Vector3());
        const box = new T.Box3().setFromObject(weapon);
        const corners = [box.min, box.max].flatMap(a => [box.min, box.max].flatMap(b => [box.min, box.max].map(c =>
          new T.Vector3(a.x, b.y, c.z))));
        const tip = corners.reduce((far, corner) => corner.distanceTo(hand) > far.distanceTo(hand) ? corner : far);
        const local = worker.root.worldToLocal(tip.clone()).sub(worker.root.worldToLocal(hand.clone())).normalize();
        const intended = meleePose(frame);
        const expected = new T.Vector3(...weaponDirection(intended.pitch, intended.yaw));
        const name = `${nation}-${entry.type}-${swordPoseLabel(entry)}`;
        blades.push({ error: Math.round(local.angleTo(expected) * 180 / Math.PI), name });
        for (const [label, x, z] of [["side", -2.6, .4], ["front", .3, 2.8]] as const) {
          camera.position.set(x, 1.3, z); camera.lookAt(0, .7, .2); renderer.render(scene, camera);
          captures.push({ name: `${name}-${label}`, png: renderer.domElement.toDataURL().split(",")[1]! });
        }
      }
      scene.remove(worker.root);
    }
    return { blades, captures };
  });
  for (const capture of report.captures) writeFileSync(resolve(output, `${capture.name}.png`), Buffer.from(capture.png, "base64"));
  console.log(JSON.stringify(report.blades), errors);
} finally { await browser.close(); await server.close(); }

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Stone material deposits: the in-game boulder cluster (stone-deposit-cluster.ts, same rock shapes as
 * the quarry stone boulders) recoloured per material, rendered as the map editor icons
 * `assets/editor-icons/<stone>-deposit.png` plus High / Minimal review sheets per size state.
 */
const output = resourcesPath("settlement-previews", "stone-sources");
mkdirSync(output, { recursive: true });
mkdirSync(resolve("assets/editor-icons"), { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/stone-review.html", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}stone-review.html`);
  const result = await page.evaluate(async () => {
    const t = await import(/* @vite-ignore */ String("/@id/three"));
    const { RoomEnvironment } = await import(/* @vite-ignore */ String("/@id/three/examples/jsm/environments/RoomEnvironment.js"));
    const cluster = await import(/* @vite-ignore */ String("/src/render-common/rocks/stone-deposit-cluster.ts"));
    const renderer = new t.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(256, 256); renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = .72;
    const scene = new t.Scene(), camera = new t.OrthographicCamera(-1.65, 1.65, 1.65, -1.65, .01, 20);
    camera.position.set(2.7, 2.4, 3.4); camera.lookAt(0, .2, 0);
    const pmrem = new t.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, .04);
    scene.environment = env.texture; scene.environmentIntensity = .4;
    const key = new t.DirectionalLight(0xfff2df, 2.2); key.position.set(-3, 7, 4);
    scene.add(key, new t.HemisphereLight(0xeaf3ff, 0x9e8e78, 1));
    const terrain = { cellsX: 64, cellsZ: 64, height: () => 0, moisture: () => .3, mountain: () => 0, visibility: () => 1 };
    const amounts = [48, 28, 10];
    const rows: { material: string; detailed: boolean; variant: number; state: number; image: string; triangles: number }[] = [];
    for (const detailed of [true, false]) for (const material of ["marble", "limestone", "basalt", "granite"])
      for (let variant = 0; variant < 4; variant++) for (let state = 0; state < amounts.length; state++) {
        const deposit = { id: variant, remaining: amounts[state]!, x: 0, z: 0 };
        const data = cluster.buildDepositClusterMesh(deposit, 7, terrain, !detailed);
        const geometry = new t.BufferGeometry();
        geometry.setAttribute("position", new t.BufferAttribute(data.positions, 3));
        geometry.setAttribute("normal", new t.BufferAttribute(data.normals, 3));
        // Crevice darkening from the rock mask's cavity byte, as the rock shader does.
        const colors = new Float32Array(data.vertexCount * 3);
        for (let at = 0; at < data.vertexCount; at++) colors.fill(1 - data.mask[at * 4 + 3]! / 255 * .7, at * 3, at * 3 + 3);
        geometry.setAttribute("color", new t.BufferAttribute(colors, 3));
        geometry.setIndex(new t.BufferAttribute(data.indices, 1));
        const tint = cluster.STONE_DEPOSIT_TINTS[material];
        const mesh = new t.Mesh(geometry, new t.MeshStandardMaterial({ color: new t.Color().setRGB(...tint, t.SRGBColorSpace), roughness: .9, vertexColors: true }));
        scene.add(mesh); renderer.render(scene, camera);
        rows.push({ material, detailed, variant, state, image: renderer.domElement.toDataURL("image/png"), triangles: data.triangles });
        mesh.removeFromParent(); geometry.dispose(); mesh.material.dispose();
      }
    env.texture.dispose(); room.dispose(); pmrem.dispose(); renderer.dispose();
    return rows;
  });
  for (const row of result.filter(row => row.detailed && row.variant === 0 && row.state === 0))
    writeFileSync(resolve("assets/editor-icons", `${row.material}-deposit.png`), Buffer.from(row.image.split(",")[1]!, "base64"));
  writeFileSync(resolve(output, "geometry.json"), JSON.stringify(result.map(({ image: _, ...row }) => row), null, 2));
  for (const detailed of [true, false]) for (const state of [0, 1, 2]) {
    const rows = result.filter(row => row.detailed === detailed && row.state === state);
    await page.setContent(`<style>body{background:#e9dfc6;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(4,280px)}figure{margin:8px;text-align:center;background:#fbf2df}img{width:256px;height:256px}</style><h1>Stone deposit boulders: ${detailed ? "High" : "Minimal"}, size state ${state}</h1><main>${rows.map(row => `<figure><img src="${row.image}"><figcaption>${row.material} ${row.variant + 1} · ${row.triangles} triangles</figcaption></figure>`).join("")}</main>`);
    await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-${state}.png`), fullPage: true });
  }
  console.log(`Rendered 128 deposit cluster states and four editor icons: ${output}`);
} finally { await browser.close(); await server.close(); }

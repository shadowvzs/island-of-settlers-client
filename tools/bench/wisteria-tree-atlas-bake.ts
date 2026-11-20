import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("assets/botanical-textures");
const sourceFiles = ["src/render-common/plants/wisteria-tree-graph.ts",
  "src/renderers/three/plants/wisteria-tree-florets.ts",
  "src/renderers/three/plants/wisteria-tree-model.ts", "src/renderers/three/wisteria-botanical-templates.ts",
  "src/renderers/three/wisteria-botanical-atlas-geometry.ts",
  "src/renderers/three/wisteria-petiole-geometry.ts",
  "tools/bench/wisteria-tree-atlas-bake.ts",
  "assets/botanical-textures/wisteria-neutral-atlas-candidate.png"];
const hashes = () => Object.fromEntries(sourceFiles.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), errors: string[] = [];
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/wisteria-tree-bake.html", route => route.fulfill({ body: "<body></body>", contentType: "text/html" }));
  await page.goto(`${url}wisteria-tree-bake.html`);
  const result = await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const { createWisteriaTreeBakeSource, createWisteriaTreeMaterials } =
      await imp("/src/renderers/three/plants/wisteria-tree-model.ts");
    const { WISTERIA_LOD_TILES, wisteriaSprayFrame } = await imp("/src/renderers/three/wisteria-lod-atlas.ts");
    const loader = new t.TextureLoader();
    const atlas = await loader.loadAsync("/assets/botanical-textures/wisteria-owned-lod-atlas-candidate.png");
    const tissue = await loader.loadAsync("/assets/botanical-textures/wisteria-neutral-atlas-candidate.png");
    const oldMetadata = await fetch("/assets/botanical-textures/wisteria-owned-lod-atlas-candidate.json").then(r => r.json());
    const pack = createWisteriaTreeMaterials(true, atlas, oldMetadata, tissue);
    const botany = createWisteriaTreeBakeSource(pack), { flowers, leaves, raceme, spray } = botany;
    const anchor = new t.Vector3(...flowers[0].clusterOrigin);
    raceme.applyMatrix4(new t.Matrix4().makeRotationY(flowers[0].yaw).setPosition(anchor).invert());
    spray.applyMatrix4(wisteriaSprayFrame(leaves).invert());
    raceme.updateMatrixWorld(true); spray.updateMatrixWorld(true);
    const bounds = (root: any) => new t.Box3().setFromObject(root).expandByScalar(.0015);
    const racemeBox = bounds(raceme), sprayBox = bounds(spray);
    const encode = (box: any) => ({ min: box.min.toArray(), max: box.max.toArray() });
    const renderer = new t.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.NoToneMapping; renderer.setClearColor(0, 0);
    const scene = new t.Scene(), canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
    const context = canvas.getContext("2d")!, coverage: Record<string, number> = {};
    const albedoMaterials: any[] = [];
    // An albedo bake must not bake directional shadows into colour and then light them a second time at runtime.
    for (const root of [raceme, spray]) root.traverse((node: any) => {
      if (!node.isMesh) return;
      const original = node.material;
      const material = new t.MeshBasicMaterial({ map: original.map, alphaTest: original.alphaTest,
        side: original.side, color: original.color, vertexColors: original.vertexColors });
      node.material = material; albedoMaterials.push(material);
    });
    if (albedoMaterials.length < 5) throw new Error("Missing actual botanical albedo surfaces");
    const luminance: Record<string, number> = {};
    for (const [name, rectangle] of Object.entries(WISTERIA_LOD_TILES) as [string, readonly number[]][]) {
      const [x, y, width, height] = rectangle as [number, number, number, number];
      const leafy = name.startsWith("spray"), sideways = name.endsWith("Side");
      const root = leafy ? spray : raceme, box = leafy ? sprayBox : racemeBox, nodes: any[] = [];
      root.traverse((node: any) => { if (node.isMesh) nodes.push(node); });
      if (nodes.length === 0) throw new Error(`No actual Mesh surfaces for ${name}`);
      const centre = box.getCenter(new t.Vector3()), size = box.getSize(new t.Vector3());
      const camera = new t.OrthographicCamera(-(sideways ? size.z : size.x) / 2,
        (sideways ? size.z : size.x) / 2, size.y / 2, -size.y / 2, .001, 5);
      camera.position.copy(centre).add(sideways ? new t.Vector3(2, 0, 0) : new t.Vector3(0, 0, 2)); camera.lookAt(centre);
      scene.add(root); renderer.setSize(width, height); renderer.render(scene, camera);
      context.clearRect(x, y, width, height); context.drawImage(renderer.domElement, x, y, width, height);
      const image = context.getImageData(x, y, width, height);
      if (!leafy) {
        const originals = nodes.map(node => node.material);
        const ids = nodes.map(node => {
          const fixed = node.name.includes("calyces") || node.name.includes("pale_throats") || node.name === "";
          const material = new t.MeshBasicMaterial({ color: fixed ? 0x00ff00 : 0xff0000,
            map: node.material.map, alphaTest: node.material.alphaTest, side: node.material.side });
          node.material = material; return material;
        });
        renderer.render(scene, camera); context.clearRect(x, y, width, height);
        context.drawImage(renderer.domElement, x, y, width, height);
        const mask = context.getImageData(x, y, width, height).data;
        for (let pixel = 0; pixel < mask.length; pixel += 4)
          if ((mask[pixel + 1]! > mask[pixel]!) !== name.startsWith("fixed")) image.data[pixel + 3] = 0;
        nodes.forEach((node, index) => { node.material = originals[index]; }); ids.forEach(material => material.dispose());
        context.putImageData(image, x, y);
      }
      let filled = 0, brightness = 0;
      for (let pixel = 3; pixel < image.data.length; pixel += 4) if (image.data[pixel]! >= 82) {
        filled++; brightness += (image.data[pixel - 3]! + image.data[pixel - 2]! + image.data[pixel - 1]!) / (3 * 255);
      }
      coverage[name] = filled / (width * height);
      luminance[name] = filled ? brightness / filled : 0;
      if (!name.startsWith("fixed") && luminance[name]! < .12)
        throw new Error(`Black botanical albedo ${name}: ${luminance[name]}`);
      if (coverage[name]! <= (name.startsWith("fixed") ? .00001 : .002))
        throw new Error(`Empty tree atlas ${name}: ${coverage[name]}`);
      root.removeFromParent();
    }
    const firstPair = new t.Vector3(...leaves[0].position).add(new t.Vector3(...leaves[1].position)).multiplyScalar(.5);
    const metadata = { version: 2, source: "standalone-tree-representative-eleven-floret-albedo", raceme: encode(racemeBox), spray: encode(sprayBox),
      racemeSpan: flowers[0].position[1] - flowers.at(-1).position[1],
      spraySpan: firstPair.distanceTo(new t.Vector3(...leaves.at(-1).position)), coverage, luminance };
    const image = canvas.toDataURL("image/png").split(",")[1]!;
    albedoMaterials.forEach(material => material.dispose()); botany.dispose(); pack.dispose();
    renderer.dispose(); renderer.forceContextLoss(); return { image, metadata };
  });
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "wisteria-tree-lod-albedo.png"), Buffer.from(result.image, "base64"));
  writeFileSync(resolve(output, "wisteria-tree-lod-albedo.json"), JSON.stringify({ ...result.metadata, hashes: before }, null, 2));
  console.log(JSON.stringify({ atlas: "wisteria-tree-lod-albedo.png", metadata: result.metadata }));
  await page.close();
} finally { await browser.close(); await server.close(); }

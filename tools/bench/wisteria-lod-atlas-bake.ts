import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("assets/botanical-textures");
mkdirSync(output, { recursive: true });
const errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/wisteria-lod-bake.html", route => route.fulfill({ body: "<body></body>", contentType: "text/html" }));
  await page.goto(`${url}wisteria-lod-bake.html`);
  const result = await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
    const { createWisteriaHero } = await imp("/src/renderers/three/wisteria-hero.ts");
    const { createWisteriaBotanicalTemplates } = await imp("/src/renderers/three/wisteria-botanical-templates.ts");
    const { createWisteriaWoodyGeometry } = await imp("/src/renderers/three/wisteria-woody-geometry.ts");
    const { groupWisteriaBotany, WISTERIA_LOD_TILES, wisteriaSprayFrame } =
      await imp("/src/renderers/three/wisteria-lod-atlas.ts");
    const templates = createWisteriaBotanicalTemplates({ neutralAtlas: true }), base = createRomanMaterials(true);
    const model = createWisteriaHero(base.materials, templates);
    const deadline = performance.now() + 15000;
    while (!templates.materials.atlasReady()) {
      if (templates.materials.atlasFailed() || performance.now() > deadline) throw new Error("Neutral atlas load failed");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const sites = model.botany.composition.sites;
    const median = [...sites].sort((a: any, b: any) => a.length - b.length)[Math.floor(sites.length / 2)];
    const flowers = groupWisteriaBotany(model.botany.flowers, "cluster").find((group: any[]) =>
      group[0].cluster === median.id);
    const leaves = groupWisteriaBotany(model.botany.leaves, "spray")[0];
    const raceme = templates.instantiate(flowers, [], [1, 1, 1]);
    const anchor = new t.Vector3(...flowers[0].clusterOrigin);
    const top = flowers[0].position, last = flowers.at(-1).position;
    const spineGeometry = createWisteriaWoodyGeometry([anchor.toArray(),
      [anchor.x + median.drift[0] * .45, anchor.y - median.length * .5, anchor.z + median.drift[1] * .45],
      [anchor.x + median.drift[0], anchor.y - median.length, anchor.z + median.drift[1]]], .0018, .0006, 2, 3);
    const spine = new t.Mesh(spineGeometry, templates.materials.calyx); spine.name = "baked_fixed_rachis";
    raceme.root.add(spine);
    // Undo the selected cluster's phase once; every placed cluster reapplies its own canonical yaw.
    const racemeFrame = new t.Matrix4().makeRotationY(flowers[0].yaw).setPosition(anchor);
    raceme.root.applyMatrix4(racemeFrame.clone().invert());
    const spray = templates.instantiate([], leaves, [1, 1, 1]);
    const sprayFrame = wisteriaSprayFrame(leaves);
    const pairs = Array.from({ length: 6 }, (_, index) => new t.Vector3(...leaves[index * 2].position)
      .add(new t.Vector3(...leaves[index * 2 + 1].position)).multiplyScalar(.5));
    const leafSpineGeometry = createWisteriaWoodyGeometry([new t.Vector3().setFromMatrixPosition(sprayFrame).toArray(), ...pairs.map((value: any) => value.toArray()),
      leaves.at(-1).position], .0022, .00065, 6, 3);
    const leafSpine = new t.Mesh(leafSpineGeometry, templates.materials.calyx); leafSpine.name = "baked_leaf_rachis";
    spray.root.add(leafSpine); spray.root.applyMatrix4(sprayFrame.clone().invert());
    raceme.root.updateMatrixWorld(true); spray.root.updateMatrixWorld(true);
    const bounds = (root: any) => new t.Box3().setFromObject(root).expandByScalar(.0015);
    const racemeBounds = bounds(raceme.root), sprayBounds = bounds(spray.root);
    const encodeBounds = (box: any) => ({ min: box.min.toArray(), max: box.max.toArray() });
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
    const context = canvas.getContext("2d")!;
    const renderer = new t.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
    renderer.toneMapping = t.NoToneMapping; renderer.setClearColor(0, 0);
    const scene = new t.Scene(); scene.add(new t.HemisphereLight(0xffffff, 0xc4c8b8, 2));
    const light = new t.DirectionalLight(0xffffff, 1); light.position.set(-2, 3, 5); scene.add(light);
    const coverage: Record<string, number> = {};
    for (const [name, rectangle] of Object.entries(WISTERIA_LOD_TILES) as [string, readonly [number, number, number, number]][]) {
      const [x, y, width, height] = rectangle, leafy = name.startsWith("spray"), side = name.endsWith("Side");
      const root = leafy ? spray.root : raceme.root, box = leafy ? sprayBounds : racemeBounds;
      const nodes: any[] = [];
      root.traverse((node: any) => {
        if (!(node instanceof t.InstancedMesh) && !(node instanceof t.Mesh)) return;
        nodes.push(node); node.visible = true;
      });
      scene.add(root);
      const center = box.getCenter(new t.Vector3()), size = box.getSize(new t.Vector3());
      const halfWidth = (side ? size.z : size.x) / 2, halfHeight = size.y / 2;
      const camera = new t.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, .001, 5);
      camera.position.copy(center).add(side ? new t.Vector3(2, 0, 0) : new t.Vector3(0, 0, 2));
      camera.lookAt(center); renderer.setSize(width, height);
      // Render the complete original template first. A separate material-ID render classifies
      // visible pixels, retaining true occlusion without altering botanical albedo or alpha.
      renderer.render(scene, camera);
      context.clearRect(x, y, width, height);
      context.drawImage(renderer.domElement, x, y, width, height);
      const tissue = context.getImageData(x, y, width, height);
      if (!leafy) {
        const originals = nodes.map(node => node.material);
        const ids = nodes.map(node => {
          const fixed = node.name.includes("calyces") || node.name.includes("pale_throats") ||
            node.name === "baked_fixed_rachis";
          const original = node.material;
          const material = new t.MeshBasicMaterial({ color: fixed ? 0x00ff00 : 0xff0000,
            map: original.map, alphaTest: original.alphaTest, side: original.side });
          node.material = material; return material;
        });
        renderer.render(scene, camera);
        context.clearRect(x, y, width, height);
        context.drawImage(renderer.domElement, x, y, width, height);
        const mask = context.getImageData(x, y, width, height).data;
        for (let pixel = 0; pixel < mask.length; pixel += 4) {
          const fixed = mask[pixel + 1]! > mask[pixel]!;
          if (fixed !== name.startsWith("fixed")) tissue.data[pixel + 3] = 0;
        }
        nodes.forEach((node, index) => { node.material = originals[index]; });
        ids.forEach(material => material.dispose());
        context.putImageData(tissue, x, y);
      }
      const pixels = tissue.data;
      let occupied = 0;
      for (let pixel = 3; pixel < pixels.length; pixel += 4) if (pixels[pixel]! >= 82) occupied++;
      coverage[name] = occupied / (width * height);
      if (coverage[name]! <= .002) throw new Error(`Empty botanical bake tile ${name}`);
      root.removeFromParent();
    }
    const image = canvas.toDataURL("image/png").split(",")[1]!;
    const metadata = { version: 2, sourceCluster: median.id, sourceLength: median.length, raceme: encodeBounds(racemeBounds), spray: encodeBounds(sprayBounds),
      racemeSpan: top[1] - last[1], spraySpan: pairs[0].distanceTo(new t.Vector3(...leaves.at(-1).position)), coverage };
    raceme.dispose(); spray.dispose(); model.dispose(); templates.dispose(); base.dispose();
    spineGeometry.dispose(); leafSpineGeometry.dispose(); renderer.dispose(); renderer.forceContextLoss();
    return { image, metadata };
  });
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "wisteria-owned-lod-atlas-candidate.png"), Buffer.from(result.image, "base64"));
  writeFileSync(resolve(output, "wisteria-owned-lod-atlas-candidate.json"), JSON.stringify(result.metadata, null, 2));
  console.log(JSON.stringify({ atlas: "wisteria-owned-lod-atlas-candidate.png", metadata: result.metadata }));
  await page.close();
} finally { await browser.close(); await server.close(); }

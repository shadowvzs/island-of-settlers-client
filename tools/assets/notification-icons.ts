import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "../bench/browser";

const output = resolve("assets/ui-icons/notifications"); mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 128, height: 128 } }), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/notification-icons.html", route => route.fulfill({
    body: "<body style='margin:0;background:transparent'></body>", contentType: "text/html" }));
  await page.goto(`${url}notification-icons.html`);
  await page.evaluate(async () => {
    const t = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
    const renderer = new t.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(128, 128); renderer.setClearColor(0, 0);
    renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05; document.body.append(renderer.domElement);
    const scene = new t.Scene(), group = new t.Group(); scene.add(group);
    scene.add(new t.HemisphereLight(0xffffff, 0x596b7c, 2.4));
    const light = new t.DirectionalLight(0xfff4df, 3.5); light.position.set(-2, 4, 5); scene.add(light);
    const rim = new t.DirectionalLight(0xb9d9ff, 2); rim.position.set(3, -1, 2); scene.add(rim);
    const camera = new t.OrthographicCamera(-1, 1, 1, -1, .1, 20); camera.position.set(.36, .18, 4);
    camera.lookAt(0, 0, 0);
    const polygon = (points: number[][], colour: number, z = 0, depth = .15) => {
      const shape = new t.Shape(); points.forEach(([x, y], i) => { if (i) shape.lineTo(x, y); else shape.moveTo(x, y); });
      shape.closePath();
      const geometry = new t.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3,
        bevelSize: .025, bevelThickness: .025, steps: 1, curveSegments: 32 });
      const mesh = new t.Mesh(geometry, new t.MeshStandardMaterial({ color: colour, metalness: .20, roughness: .32 }));
      mesh.position.z = z; group.add(mesh); return mesh;
    };
    (window as any).__notificationIcons = {
      draw: (kind: string) => {
        group.children.slice().forEach((mesh: any) => { mesh.geometry.dispose(); mesh.material.dispose(); group.remove(mesh); });
        if (kind === "error") {
          const cross = polygon([[-.17,.66],[.17,.66],[.17,.17],[.66,.17],[.66,-.17],[.17,-.17],
            [.17,-.66],[-.17,-.66],[-.17,-.17],[-.66,-.17],[-.66,.17],[-.17,.17]], 0xcb302b);
          cross.rotation.z = Math.PI / 4;
        } else if (kind === "success") polygon([[-.70,.02],[-.48,.23],[-.14,-.12],
          [.51,.58],[.73,.37],[-.14,-.56]], 0x35a650);
        else if (kind === "warning") {
          polygon([[0,.76],[-.78,-.61],[.78,-.61]], 0xf6bd26);
          polygon([[-.075,.33],[.075,.33],[.05,-.19],[-.05,-.19]], 0x443418, .19, .04);
          polygon([[-.07,-.31],[.07,-.31],[.07,-.45],[-.07,-.45]], 0x443418, .19, .04);
        } else {
          const points = Array.from({ length: 64 }, (_, i) => [Math.cos(i * Math.PI / 32) * .73, Math.sin(i * Math.PI / 32) * .73]);
          polygon(points, 0x2e87cd);
          polygon([[-.075,.13],[.075,.13],[.075,-.42],[-.075,-.42]], 0xf5f8ff, .19, .04);
          polygon([[-.08,.39],[.08,.39],[.08,.24],[-.08,.24]], 0xf5f8ff, .19, .04);
        }
        renderer.render(scene, camera);
      },
      dispose: () => {
        group.traverse((mesh: any) => { if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); } });
        renderer.dispose();
      }
    };
  });
  for (const kind of ["error", "warning", "success", "info"]) {
    await page.evaluate(kind => (window as any).__notificationIcons.draw(kind), kind);
    await page.locator("canvas").screenshot({ omitBackground: true, path: resolve(output, `${kind}.png`) });
  }
  await page.evaluate(() => (window as any).__notificationIcons.dispose()); assert.deepEqual(errors, []);
  console.log("Exported four original 3D notification icons");
} finally { await browser.close(); await server.close(); }

/**
 * In-page renderer of the army troop icons (`assets/ui-icons/army-<nation>-<type>.png`), shared by
 * the exporter `tools/bench/army-icons.ts` and the icon comparison `tests-ui/visual/ui-
 * icons.spec.ts` (TEST-01). Runs inside the page through `page.evaluate`, so it must stay self-
 * contained (dynamic imports only).
 */
export const renderArmyIcons = async () => {
  const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  const { RoomEnvironment } = await import(/* @vite-ignore */ String("/node_modules/three/examples/jsm/environments/RoomEnvironment.js"));
  const { createArmyIconModel } = await import(/* @vite-ignore */ String("/src/renderers/three/army-icon-model.ts"));
  const renderer = new three.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(384, 384); renderer.setClearColor(0, 0); renderer.setPixelRatio(1);
  renderer.toneMapping = three.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  const scene = new three.Scene(), pmrem = new three.PMREMGenerator(renderer), room = new RoomEnvironment();
  const reflection = pmrem.fromScene(room, .04); scene.environment = reflection.texture;
  scene.environmentIntensity = .8; room.dispose(); pmrem.dispose();
  scene.add(new three.HemisphereLight(0xe8f0ff, 0xc7a982, .75));
  const key = new three.DirectionalLight(0xfff0d9, 3); key.position.set(-2.5, 5, 4); scene.add(key);
  const fill = new three.DirectionalLight(0xe0ebff, .7); fill.position.set(3, 1, -2); scene.add(fill);
  const camera = new three.OrthographicCamera(-1, 1, 1, -1, .01, 10);
  const results = [];
  for (const nation of ["roman", "viking", "nubian", "japanese", "indigenous", "chinese", "persian", "maya"]) {
    for (const type of ["shield", "heavy", "archer"]) {
      const model = createArmyIconModel(nation, type); scene.add(model.root);
      model.root.updateMatrixWorld(true);
      const bounds = new three.Box3().setFromObject(model.root);
      const center = bounds.getCenter(new three.Vector3());
      camera.position.copy(center).add(new three.Vector3(.65, .36, 1.8)); camera.lookAt(center);
      camera.left = camera.bottom = -1; camera.right = camera.top = 1; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      let half = 0;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new three.Vector3(x, y, z).project(camera);
          half = Math.max(half, Math.abs(projected.x), Math.abs(projected.y));
        }
      half *= 1.08;
      camera.left = camera.bottom = -half; camera.right = camera.top = half; camera.updateProjectionMatrix();
      renderer.clear(); renderer.render(scene, camera);
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 192;
      canvas.getContext("2d")!.drawImage(renderer.domElement, 0, 0, 192, 192);
      results.push({ name: `army-${nation}-${type}`, data: canvas.toDataURL(), triangles: renderer.info.render.triangles });
      model.dispose();
    }
  }
  reflection.dispose(); renderer.dispose(); return results;
};

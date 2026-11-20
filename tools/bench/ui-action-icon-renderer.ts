/**
 * In-page HUD action icon renderer (functions run inside a blank page through `page.evaluate`):
 * shared by the exporter `ui-action-icons.ts` and the comparison
 * `tests-ui/visual/ui-action-icons.spec.ts`. They must stay self-contained (serialized into the page).
 */

/**
 * Fixed orthographic studio: room reflections, hemisphere, warm key and cool rim light. `set` picks the
 * registry: the HUD action icons, or `ai` (map-editor Computer faction icons, `ui-action-icon-faction-ai.ts`).
 */
export const setupUiActionIconRenderer = async (set = "actions") => {
  const three = await import(
    /* @vite-ignore */ String("/@id/three")
  );
  const { RoomEnvironment } = await import(
    /* @vite-ignore */ String("/@id/three/examples/jsm/environments/RoomEnvironment.js")
  );
  const { UI_ACTION_ICONS } = set === "ai"
    ? { UI_ACTION_ICONS: (await import(
      /* @vite-ignore */ String("/tools/bench/ui-action-icon-faction-ai.ts")
    )).UI_FACTION_AI_ICONS }
    : await import(/* @vite-ignore */ String("/tools/bench/ui-action-icon-models.ts"));
  const { disposeTree } = await import(
    /* @vite-ignore */ String("/tools/bench/ui-action-icon-kit.ts")
  );
  const renderer = new three.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setSize(512, 512);
  renderer.setClearColor(0, 0);
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  const scene = new three.Scene(),
    pmrem = new three.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const reflection = pmrem.fromScene(room, 0.04);
  scene.environment = reflection.texture;
  scene.environmentIntensity = 0.75;
  room.dispose();
  pmrem.dispose();
  scene.add(new three.HemisphereLight(0xfff4dc, 0x5a4a3a, 1.2));
  const key = new three.DirectionalLight(0xfff1dc, 2.6);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new three.DirectionalLight(0xbfdcff, 1.2);
  rim.position.set(4, 2, -3);
  scene.add(rim);
  const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
  (window as any).__uiActionIcons = {
    camera,
    disposeTree,
    reflection,
    renderer,
    scene,
    three,
    UI_ACTION_ICONS
  };
  return Object.keys(UI_ACTION_ICONS) as string[];
};

/**
 * Renders one action icon framed to its projected bounds; returns the 128 px WebP as base64. A model may
 * set `userData.iconView` (camera direction) to override the front or elevated view.
 */
export const renderUiActionIcon = (name: string) => {
  const { camera, disposeTree, renderer, scene, three, UI_ACTION_ICONS } = (window as any)
    .__uiActionIcons;
  const elevated = new Set(["dirt", "mapEditor", "stone", "territory", "warehouse"]);
  const frame = (root: any) => {
    const custom = root.userData.iconView as [number, number, number] | undefined;
    const view = new three.Vector3(0.5, 0.45, 2);
    if (custom) view.set(...custom);
    else if (elevated.has(name)) view.set(1, 2.2, 1.6);
    camera.position.copy(view.multiplyScalar(4));
    camera.lookAt(0, 0, 0);
    camera.left = camera.bottom = -1;
    camera.right = camera.top = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    const box = [Infinity, -Infinity, Infinity, -Infinity];
    root.traverse((object: any) => {
      const position = object.isMesh && object.geometry.getAttribute("position");
      for (let index = 0; position && index < position.count; index++) {
        const point = new three.Vector3()
          .fromBufferAttribute(position, index)
          .applyMatrix4(object.matrixWorld)
          .project(camera);
        box[0] = Math.min(box[0]!, point.x);
        box[1] = Math.max(box[1]!, point.x);
        box[2] = Math.min(box[2]!, point.y);
        box[3] = Math.max(box[3]!, point.y);
      }
    });
    const middleX = (box[0]! + box[1]!) / 2,
      middleY = (box[2]! + box[3]!) / 2;
    const span = (Math.max(box[1]! - box[0]!, box[3]! - box[2]!) / 2) * 1.04;
    camera.left = middleX - span;
    camera.right = middleX + span;
    camera.bottom = middleY - span;
    camera.top = middleY + span;
    camera.updateProjectionMatrix();
  };
  const root = UI_ACTION_ICONS[name]!();
  scene.add(root);
  frame(root);
  renderer.render(scene, camera);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(renderer.domElement, 0, 0, 128, 128);
  scene.remove(root);
  disposeTree(root);
  return canvas.toDataURL("image/webp", 0.9).split(",")[1]!;
};

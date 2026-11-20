/**
 * In-page renderer of the Build launcher icon (`assets/ui-icons/roman-buildings.png`, the Roman HQ
 * on `building-showcase.html?building=0`), shared by the exporter `tools/bench/main-building-icon-
 * render.ts` and the icon comparison `tests-ui/visual/ui-icons.spec.ts` (TEST-01). Runs inside the
 * page through `page.evaluate`, so it must stay self-contained (dynamic imports only).
 */
export const renderMainBuildingIcon = async () => {
  const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  const preview = (window as any).__buildingPreview;
  preview.renderer.setAnimationLoop(null);
  const root = preview.model().root;
  preview.model().update(0, { construction: 1, door: 0, working: false });
  const scene = new T.Scene(); scene.add(root);
  scene.add(new T.HemisphereLight("#fff1db", "#677581", 2));
  const sun = new T.DirectionalLight("#fff2df", 2.5); sun.position.set(-5, 10, 8); scene.add(sun);
  const bounds = new T.Box3().setFromObject(root), center = bounds.getCenter(new T.Vector3());
  const span = bounds.getSize(new T.Vector3()).length() * .48;
  const camera = new T.OrthographicCamera(-span, span, span, -span, .01, 100);
  camera.position.copy(center).add(new T.Vector3(8, 7, 10)); camera.lookAt(center);
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(512, 512); renderer.setClearColor(0, 0); renderer.render(scene, camera);
  const result = renderer.domElement.toDataURL("image/png").split(",")[1]; renderer.dispose();
  return result;
};

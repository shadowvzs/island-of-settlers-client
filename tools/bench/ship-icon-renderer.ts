/**
 * In-page renderer of the nation ship icons (`assets/ui-icons/roman-merchant-ship.png`,
 * `ships/*.png`), shared by the exporter `tools/bench/ship-icon-render.ts` and the icon comparison
 * `tests-ui/visual/ui-icons.spec.ts` (TEST-01). Runs inside the page through `page.evaluate`, so
 * it must stay self-contained (dynamic imports only).
 */

/**
 * Each nation's actual ship model as a transparent 512 px UI icon. The Roman merchant keeps its
 * established path; the others live under assets/ui-icons/ships/.
 */
export const SHIP_ICONS = [
  { file: "assets/ui-icons/roman-merchant-ship.png", nation: "roman" },
  { file: "assets/ui-icons/ships/viking-longship.png", nation: "viking" },
  { file: "assets/ui-icons/ships/japanese-bune.png", nation: "japanese" },
  { file: "assets/ui-icons/ships/nubian-trader.png", nation: "nubian" },
  { file: "assets/ui-icons/ships/chinese-junk.png", nation: "chinese" },
  { file: "assets/ui-icons/ships/persian-trader.png", nation: "persian" },
  { file: "assets/ui-icons/ships/maya-trader.png", nation: "maya" },
  { file: "assets/ui-icons/ships/indigenous-trader.png", nation: "indigenous" }
] as const;

export const NEUTRAL_SHIP_ICONS = SHIP_ICONS.map(icon => ({ nation: icon.nation,
  file: `assets/ui-icons/ships/neutral-${icon.nation}.png` }));

export const renderShipIcon = async ({ nation, neutral = false }: { nation: string; neutral?: boolean }) => {
  const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  const S = await import(/* @vite-ignore */ String("/src/renderers/three/settlement/three-ships.ts"));
  const layer = S.createThreeSettlementShips("high");
  await layer.ready;
  const scene = new T.Scene();
  scene.add(layer.group, new T.HemisphereLight("#fff4e4", "#78838e", 2.3));
  const sun = new T.DirectionalLight("#fff0d2", 3);
  sun.position.set(-8, 12, 10); scene.add(sun);
  const camera = new T.OrthographicCamera(-5.8, 5.8, 5.8, -5.8, .01, 100);
  camera.position.set(15, 13.8, 19); camera.lookAt(0, 3.8, 0);
  if (["chinese", "persian", "maya", "indigenous"].includes(nation)) {
    camera.left = -6.3; camera.right = 6.3; camera.top = 6.3; camera.bottom = -6.3;
    camera.position.set(15, 14.5, 19); camera.lookAt(0, 4.5, 0); camera.updateProjectionMatrix();
  }
  if (nation === "chinese") {
    camera.left = -7.3; camera.right = 7.3; camera.top = 7.3; camera.bottom = -7.3;
    camera.position.set(15, 16, 19); camera.lookAt(0, 5.2, 0); camera.updateProjectionMatrix();
  }
  layer.update([{ cargoCount: 0, id: 1, ...(neutral ? { livery: "neutral", nation } : {}), phase: "idle", x: 0, y: 0, yaw: -.3, z: 0 }], [], 0,
    { playerNation: nation });
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(512, 512); renderer.setClearColor(0, 0);
  renderer.render(scene, camera);
  const result = renderer.domElement.toDataURL("image/png").split(",")[1];
  layer.dispose(); renderer.dispose();
  return result;
};

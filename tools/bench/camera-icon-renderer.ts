/**
 * In-page renderer of the HUD camera-panel icons (`assets/ui-icons/camera/*.png`), shared by the
 * exporter `tools/bench/camera-icon-render.ts` and the icon comparison `tests-ui/visual/ui-
 * icons.spec.ts` (TEST-01). Runs inside the page through `page.evaluate`, so it must stay self-
 * contained (dynamic imports only).
 */
export const renderCameraIcons = async () => {
  const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(128, 128); renderer.setClearColor(0, 0);
  const camera = new T.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, .1, 30);
  camera.position.set(.65, .85, 6); camera.lookAt(0, 0, 0);
  const gold = new T.MeshStandardMaterial({ color: "#e7b65b", metalness: .52, roughness: .34 });
  const dark = new T.MeshStandardMaterial({ color: "#443c32", metalness: .3, roughness: .4 });
  const bronze = new T.MeshStandardMaterial({ color: "#946326", metalness: .45, roughness: .4 });
  const glass = new T.MeshStandardMaterial({ color: "#366678", metalness: .65, roughness: .12 });
  const result: Record<string, string> = {};
  const flat = (points: number[][]) => {
    const shape = new T.Shape();
    points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
    return new T.Mesh(new T.ExtrudeGeometry(shape, {
      depth: .23, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .045, bevelThickness: .045
    }), [gold, bronze]);
  };
  const curved = () => {
    const points: number[][] = [];
    for (let i = 0; i <= 40; i++) {
      const angle = (.3 + i / 40 * 1.45) * Math.PI;
      points.push([Math.cos(angle) * .72, Math.sin(angle) * .72]);
    }
    for (let i = 40; i >= 0; i--) {
      const angle = (.3 + i / 40 * 1.45) * Math.PI;
      points.push([Math.cos(angle) * .48, Math.sin(angle) * .48]);
    }
    const root = new T.Group(); root.add(flat(points));
    const head = flat([[.3, -.9], [.92, -.53], [.27, -.35]]); root.add(head);
    return root;
  };
  const cameraModel = () => {
    const root = new T.Group();
    const body = flat([[-.85, -.5], [.75, -.5], [.75, .48], [-.85, .48]]); root.add(body);
    const panel = new T.Mesh(new T.BoxGeometry(1.35, .65, .04), dark);
    panel.position.set(-.05, -.02, .22); root.add(panel);
    const lens = new T.Mesh(new T.CylinderGeometry(.38, .4, .48, 48), dark);
    lens.rotation.x = Math.PI / 2; lens.position.set(.15, -.02, .48); root.add(lens);
    const ring = new T.Mesh(new T.TorusGeometry(.32, .045, 12, 48), gold);
    ring.position.set(.15, -.02, .75); root.add(ring);
    const front = new T.Mesh(new T.CircleGeometry(.29, 48), glass);
    front.position.set(.15, -.02, .758); root.add(front);
    const viewfinder = new T.Mesh(new T.BoxGeometry(.45, .2, .22), dark);
    viewfinder.position.set(-.3, .59, .1); root.add(viewfinder);
    return root;
  };
  for (const name of ["left", "right", "up", "down", "rotate-left", "rotate-right",
    "pitch-up", "pitch-down", "plus", "minus", "reset", "camera"]) {
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight("#fff2d7", "#635c58", 2.6));
    const light = new T.DirectionalLight("#fff6e6", 4); light.position.set(-3, 5, 6); scene.add(light);
    let root;
    if (name === "camera") root = cameraModel();
    else if (name === "plus" || name === "minus") {
      root = new T.Group(); root.add(flat([[-.8, -.13], [.8, -.13], [.8, .13], [-.8, .13]]));
      if (name === "plus") root.add(flat([[-.13, -.8], [.13, -.8], [.13, .8], [-.13, .8]]));
    } else if (name === "reset" || name.includes("rotate") || name.includes("pitch")) {
      root = curved();
      if (name === "rotate-left") root.scale.x = -1;
      if (name.includes("pitch")) { root.rotation.z = Math.PI / 2; root.rotation.y = .65; }
      if (name === "pitch-down") root.scale.y = -1;
    } else {
      root = flat([[-.82, -.17], [.18, -.17], [.18, -.48], [.87, 0], [.18, .48], [.18, .17], [-.82, .17]]);
      root.rotation.z = { right: 0, left: Math.PI, up: Math.PI / 2, down: -Math.PI / 2 }[name]!;
    }
    scene.add(root); renderer.render(scene, camera);
    result[name] = renderer.domElement.toDataURL("image/png").split(",")[1]!;
    root.traverse((object: any) => object.geometry?.dispose());
  }
  renderer.dispose(); gold.dispose(); bronze.dispose(); dark.dispose(); glass.dispose();
  return result;
};

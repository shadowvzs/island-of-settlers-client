/**
 * In-page renderer of the progression HUD art (gem, quest scroll, level star, portrait frame,
 * rally flag, victory emblems, theme modes; `assets/ui-icons/*.png`), shared by the exporter
 * `tools/bench/progression-icons.ts` and the icon comparison `tests-ui/visual/ui-icons.spec.ts`
 * (TEST-01). Runs inside the page through `page.evaluate`, so it must stay self-contained (dynamic
 * imports only).
 */
export const renderProgressionIcons = async () => {
  const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(256, 256); renderer.setClearColor(0, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  const camera = new T.PerspectiveCamera(30, 1, .1, 40);
  const result: Record<string, string> = {};
  const emblems: typeof import("./victory-emblems") =
    await import(/* @vite-ignore */ String("/tools/bench/victory-emblems.ts"));

  /** Hexagonal crystal: prism body with pyramid tip, faceted (flat shaded). */
  const crystal = (height: number, radius: number, material: any) => {
    const points = [new T.Vector2(0, -height * .12), new T.Vector2(radius * .78, 0),
      new T.Vector2(radius, height * .62), new T.Vector2(0, height)];
    const mesh = new T.Mesh(new T.LatheGeometry(points, 6), material);
    mesh.geometry.computeVertexNormals();
    return mesh;
  };
  const gem = () => {
    const root = new T.Group();
    const blue = new T.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: .05, color: "#2f8cff",
      emissive: "#0b3d8f", emissiveIntensity: .35, flatShading: true, metalness: .1, roughness: .08,
      sheen: .4, sheenColor: "#9fd8ff" });
    const pale = blue.clone(); pale.color = new T.Color("#5fb6ff"); pale.emissive = new T.Color("#0e4aa6");
    const rock = new T.MeshStandardMaterial({ color: "#6e6658", flatShading: true, roughness: .9 });
    const base = new T.Mesh(new T.DodecahedronGeometry(.62, 0), rock);
    base.scale.set(1.25, .38, 1); base.position.y = -.62; root.add(base);
    const main = crystal(1.8, .34, blue); main.position.set(0, -.62, 0); main.rotation.z = -.08; root.add(main);
    for (const [x, z, height, radius, tilt, material] of [[-.42, .1, 1.15, .24, .55, pale], [.45, .05, 1.0, .22, -.6, pale],
      [.12, .38, .78, .17, -.25, blue]] as const) {
      const shard = crystal(height, radius, material);
      shard.position.set(x, -.6, z); shard.rotation.set(.18, 0, tilt); root.add(shard);
    }
    return root;
  };
  const scroll = () => {
    const root = new T.Group();
    const paper = new T.MeshStandardMaterial({ color: "#ead7a6", roughness: .85, side: T.DoubleSide });
    const wood = new T.MeshStandardMaterial({ color: "#6b4426", roughness: .6 });
    const wax = new T.MeshStandardMaterial({ color: "#a3241e", metalness: .1, roughness: .35 });
    const sheet = new T.PlaneGeometry(1.25, 1.55, 24, 24);
    const position = sheet.getAttribute("position");
    for (let index = 0; index < position.count; index++)
      position.setZ(index, Math.sin(position.getX(index) * 2.2) * .07 + Math.sin(position.getY(index) * 3) * .03);
    sheet.computeVertexNormals(); root.add(new T.Mesh(sheet, paper));
    for (const y of [.8, -.8]) {
      const roll = new T.Mesh(new T.CylinderGeometry(.13, .13, 1.35, 24), paper);
      roll.rotation.z = Math.PI / 2; roll.position.set(0, y, .06); root.add(roll);
      for (const side of [-1, 1]) {
        const knob = new T.Mesh(new T.SphereGeometry(.1, 16, 12), wood);
        knob.position.set(side * .74, y, .06); root.add(knob);
      }
    }
    const ink = new T.MeshStandardMaterial({ color: "#5a4632", roughness: .9 });
    for (const [y, width] of [[.45, .8], [.25, .9], [.05, .7], [-.15, .85]] as const) {
      const line = new T.Mesh(new T.BoxGeometry(width, .045, .01), ink);
      line.position.set(-.05, y, .1); root.add(line);
    }
    const seal = new T.Mesh(new T.CylinderGeometry(.22, .24, .07, 24), wax);
    seal.rotation.x = Math.PI / 2; seal.position.set(.28, -.45, .13); root.add(seal);
    root.rotation.set(-.25, .35, .12);
    return root;
  };
  const star = () => {
    const root = new T.Group();
    const gold = new T.MeshStandardMaterial({ color: "#ffc94f", emissive: "#5a3a06", emissiveIntensity: .45,
      metalness: .6, roughness: .3 });
    const shape = new T.Shape();
    for (let index = 0; index < 10; index++) {
      const angle = Math.PI / 2 + index * Math.PI / 5, radius = index % 2 ? .45 : 1.05;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (index) shape.lineTo(x, y); else shape.moveTo(x, y);
    }
    shape.closePath();
    const body = new T.Mesh(new T.ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 4, bevelSize: .08,
      bevelThickness: .1, depth: .18 }), gold);
    body.position.z = -.09; root.add(body);
    root.rotation.set(-.2, .3, 0);
    return root;
  };
  /** Portrait ring: a gold band with beaded rims, four blue gems and a small crest; open centre. */
  const frame = () => {
    const root = new T.Group();
    const gold = new T.MeshStandardMaterial({ color: "#f2c35a", emissive: "#4a2f06", emissiveIntensity: .35,
      metalness: .75, roughness: .28 });
    const dark = new T.MeshStandardMaterial({ color: "#a8742a", metalness: .7, roughness: .4 });
    const blue = new T.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: .05, color: "#2f8cff",
      emissive: "#0b3d8f", emissiveIntensity: .4, flatShading: true, metalness: .1, roughness: .08 });
    const band = new T.Mesh(new T.TorusGeometry(1, .085, 20, 96), gold); band.scale.z = .7; root.add(band);
    for (const radius of [.9, 1.1]) {
      const rim = new T.Mesh(new T.TorusGeometry(radius, .03, 10, 96), dark); root.add(rim);
      for (let index = 0; index < 48; index++) {
        const angle = index / 48 * Math.PI * 2;
        const bead = new T.Mesh(new T.SphereGeometry(.026, 8, 6), gold);
        bead.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, .03); root.add(bead);
      }
    }
    for (let index = 0; index < 4; index++) {
      const angle = Math.PI / 4 + index * Math.PI / 2;
      const setting = new T.Mesh(new T.CylinderGeometry(.13, .15, .07, 16), gold);
      setting.rotation.x = Math.PI / 2; setting.position.set(Math.cos(angle), Math.sin(angle), .05); root.add(setting);
      const stone = new T.Mesh(new T.OctahedronGeometry(.11, 0), blue);
      stone.scale.z = .55; stone.position.set(Math.cos(angle), Math.sin(angle), .11); root.add(stone);
    }
    const crest = new T.Shape();
    crest.moveTo(-.2, 0); crest.quadraticCurveTo(-.24, .2, -.08, .26); crest.lineTo(0, .38); crest.lineTo(.08, .26);
    crest.quadraticCurveTo(.24, .2, .2, 0); crest.quadraticCurveTo(0, -.12, -.2, 0);
    const top = new T.Mesh(new T.ExtrudeGeometry(crest, { bevelEnabled: true, bevelSegments: 3, bevelSize: .025,
      bevelThickness: .03, depth: .06 }), gold);
    top.position.set(0, 1.02, .02); root.add(top);
    const jewel = new T.Mesh(new T.OctahedronGeometry(.07, 0), blue);
    jewel.position.set(0, 1.15, .12); root.add(jewel);
    return root;
  };
  /**
   * Rally banner: a waving red war banner with a gold border, a laurel-and-star emblem and a
   * gold fringe, on a ringed wooden pole with a spear tip, a tasselled cord and a stone base.
   */
  const rallyFlag = () => {
    const root = new T.Group();
    const wood = new T.MeshStandardMaterial({ color: "#7a4a24", roughness: .65 });
    const gold = new T.MeshStandardMaterial({ color: "#f2c35a", emissive: "#4a2f06", emissiveIntensity: .3,
      metalness: .75, roughness: .28 });
    const iron = new T.MeshStandardMaterial({ color: "#9aa3ab", metalness: .8, roughness: .3 });
    // Cloth: deep red with woven lines, a gold border and a centred laurel wreath with a star.
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 336;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#b71f22"; g.fillRect(0, 0, 512, 336);
    g.globalAlpha = .12; g.fillStyle = "#000";
    for (let y = 0; y < 336; y += 4) g.fillRect(0, y, 512, 1);
    g.globalAlpha = 1; g.strokeStyle = "#f2c35a"; g.lineWidth = 16; g.strokeRect(14, 14, 484, 308);
    g.lineWidth = 4; g.strokeRect(34, 34, 444, 268);
    g.translate(256, 168); g.fillStyle = "#f2c35a";
    for (const side of [-1, 1]) for (let leaf = 0; leaf < 8; leaf++) {
      const angle = Math.PI / 2 + side * (.35 + leaf * .3);
      g.save(); g.translate(Math.cos(angle) * 92, Math.sin(angle) * 92); g.rotate(angle + side * .9);
      g.beginPath(); g.ellipse(0, 0, 20, 8, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.beginPath();
    for (let point = 0; point < 10; point++) {
      const angle = -Math.PI / 2 + point * Math.PI / 5, radius = point % 2 ? 24 : 58;
      g.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    g.closePath(); g.fill();
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const cloth = new T.MeshStandardMaterial({ map: texture, roughness: .7, side: T.DoubleSide });
    const pole = new T.Mesh(new T.CylinderGeometry(.045, .055, 2.4, 20), wood); pole.position.y = .1; root.add(pole);
    for (const y of [-.3, .35, 1.12]) {
      const ring = new T.Mesh(new T.TorusGeometry(.058, .016, 8, 20), gold);
      ring.rotation.x = Math.PI / 2; ring.position.y = y; root.add(ring);
    }
    const spear = new T.Mesh(new T.ConeGeometry(.07, .26, 4), iron); spear.position.y = 1.44; root.add(spear);
    const collar = new T.Mesh(new T.SphereGeometry(.075, 16, 12), gold); collar.position.y = 1.3; root.add(collar);
    const banner = new T.PlaneGeometry(1.25, .82, 32, 16);
    const position = banner.getAttribute("position");
    const wave = (x: number, y: number) => Math.sin(x * 5.2 + y * .8) * .2 * x + Math.sin(y * 4 + x * 2) * .03;
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index) + .625, y = position.getY(index);
      position.setXYZ(index, x, y - x * x * .08, wave(x, y));
    }
    banner.computeVertexNormals();
    const flag = new T.Mesh(banner, cloth); flag.position.set(.05, .78, 0); root.add(flag);
    // Gold fringe along the free bottom edge, following the cloth.
    for (let tassel = 0; tassel < 22; tassel++) {
      const x = (tassel + .5) / 22 * 1.25, y = -.41 - x * x * .08;
      const thread = new T.Mesh(new T.CylinderGeometry(.008, .012, .09, 5), gold);
      thread.position.set(.05 + x, .78 + y - .04, wave(x, -.41)); root.add(thread);
    }
    // A cord tied at the top ring hangs down the pole and ends in two tassels.
    const cord = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(.03, 1.12, .05),
      new T.Vector3(-.1, .9, .12), new T.Vector3(-.08, .62, .1)]), 12, .012, 6), gold); root.add(cord);
    for (const offset of [-.03, .03]) {
      const tassel = new T.Mesh(new T.ConeGeometry(.035, .12, 10), gold);
      tassel.position.set(-.08 + offset, .55, .1); root.add(tassel);
    }
    const stone = new T.MeshStandardMaterial({ color: "#8d8577", roughness: .9, flatShading: true });
    const base = new T.Mesh(new T.CylinderGeometry(.26, .34, .14, 8), stone); base.position.y = -1.05; root.add(base);
    const step = new T.Mesh(new T.CylinderGeometry(.36, .42, .1, 8), stone); step.position.y = -1.16; root.add(step);
    root.rotation.set(-.1, -.5, 0); root.position.y = -.1;
    return root;
  };
  /** Soft round halo behind the theme-mode icons: a sprite with a radial alpha gradient. */
  const halo = (inner: string, outer: string, scale: number) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const g = canvas.getContext("2d")!;
    const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, inner); gradient.addColorStop(.4, inner); gradient.addColorStop(1, outer);
    g.fillStyle = gradient; g.fillRect(0, 0, 256, 256);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ depthWrite: false, map: texture }));
    sprite.scale.set(scale, scale, 1); sprite.position.z = -.9;
    return sprite;
  };
  /** Bevelled star with the given number of points. */
  const pointedStar = (points: number, outer: number, inner: number, material: any) => {
    const shape = new T.Shape();
    for (let point = 0; point < points * 2; point++) {
      const angle = Math.PI / 2 + point * Math.PI / points, radius = point % 2 ? inner : outer;
      shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    shape.closePath();
    return new T.Mesh(new T.ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 3, bevelSize: outer * .08,
      bevelThickness: outer * .16, depth: outer * .1 }), material);
  };
  /** Light mode: a radiant golden sun, a glossy sphere in a ring of alternating long and short rays. */
  const sun = () => {
    const root = new T.Group();
    root.add(halo("rgba(255, 214, 102, .5)", "rgba(255, 170, 40, 0)", 2.6));
    const core = new T.MeshPhysicalMaterial({ clearcoat: .8, clearcoatRoughness: .2, color: "#ffc531",
      emissive: "#ff7a00", emissiveIntensity: .45, metalness: .15, roughness: .32 });
    const longRay = new T.MeshStandardMaterial({ color: "#ffb21a", emissive: "#a94a00", emissiveIntensity: .35,
      metalness: .45, roughness: .3 });
    const shortRay = new T.MeshStandardMaterial({ color: "#ff8a1c", emissive: "#8a2c00", emissiveIntensity: .3,
      metalness: .4, roughness: .32 });
    const ray = (length: number, width: number) => {
      const shape = new T.Shape();
      shape.moveTo(-width, 0); shape.quadraticCurveTo(-width * .4, length * .55, 0, length);
      shape.quadraticCurveTo(width * .4, length * .55, width, 0); shape.closePath();
      return new T.ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 3, bevelSize: .025,
        bevelThickness: .05, curveSegments: 12, depth: .04 });
    };
    const longGeometry = ray(.52, .14), shortGeometry = ray(.34, .1);
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2, isLong = index % 2 === 0;
      const mesh = new T.Mesh(isLong ? longGeometry : shortGeometry, isLong ? longRay : shortRay);
      mesh.position.set(Math.cos(angle) * .6, Math.sin(angle) * .6, -.05);
      mesh.rotation.z = angle - Math.PI / 2; root.add(mesh);
    }
    root.add(new T.Mesh(new T.TorusGeometry(.66, .045, 16, 96), longRay));
    root.add(new T.Mesh(new T.SphereGeometry(.64, 64, 48), core));
    root.rotation.set(-.08, .12, 0);
    return root;
  };
  const CRESCENT_START = Math.PI * .27, CRESCENT_SPAN = Math.PI * 1.46;
  const CRESCENT_RADIUS = .66, CRESCENT_THICKNESS = .36, CRESCENT_DEPTH = .75;
  /** Crescent thickness along the arc (0..1): full in the middle, rounded down to the two horns. */
  const crescentThickness = (along: number) =>
    Math.max(.008, CRESCENT_THICKNESS * Math.pow(Math.sin(Math.PI * along), .8));
  /** Point on the crescent: an arc swept by a flattened circle that tapers to round horn tips. */
  const crescentPoint = (along: number, around: number) => {
    const angle = CRESCENT_START + CRESCENT_SPAN * along;
    const thickness = crescentThickness(along);
    const radial = CRESCENT_RADIUS + Math.cos(around) * thickness;
    return [Math.cos(angle) * radial, Math.sin(angle) * radial, Math.sin(around) * thickness * CRESCENT_DEPTH];
  };
  const crescentGeometry = (segments: number, sides: number) => {
    const positions: number[] = [], indices: number[] = [];
    for (let step = 0; step <= segments; step++) for (let side = 0; side <= sides; side++)
      positions.push(...crescentPoint(step / segments, side / sides * Math.PI * 2));
    for (let step = 0; step < segments; step++) for (let side = 0; side < sides; side++) {
      const corner = step * (sides + 1) + side, next = corner + sides + 1;
      indices.push(corner, next, corner + 1, corner + 1, next, next + 1);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  };
  /** Dark mode: a silver-blue crescent moon with shallow craters and pale-gold twinkling stars. */
  const moon = () => {
    const root = new T.Group();
    root.add(halo("rgba(110, 150, 255, .34)", "rgba(40, 70, 170, 0)", 2.5));
    const silver = new T.MeshPhysicalMaterial({ clearcoat: .6, clearcoatRoughness: .25, color: "#c6d7f4",
      emissive: "#203c80", emissiveIntensity: .4, metalness: .3, roughness: .34 });
    const crater = new T.MeshStandardMaterial({ color: "#8ea3c8", metalness: .2, roughness: .65 });
    const starGold = new T.MeshStandardMaterial({ color: "#fff1b0", emissive: "#a8862a", emissiveIntensity: .6,
      metalness: .55, roughness: .25 });
    const body = new T.Mesh(crescentGeometry(160, 48), silver); body.position.x = -.12; root.add(body);
    const craters = [[.3, -.08, .07], [.45, .1, .09], [.58, -.06, .06], [.72, .05, .05]] as const;
    for (const [along, offset, radius] of craters) {
      const angle = CRESCENT_START + CRESCENT_SPAN * along, thickness = crescentThickness(along);
      const depth = Math.sqrt(Math.max(0, thickness * thickness - offset * offset)) * CRESCENT_DEPTH;
      const pit = new T.Mesh(new T.SphereGeometry(radius, 20, 14), crater); pit.scale.z = .2;
      const centre = CRESCENT_RADIUS + offset;
      pit.position.set(Math.cos(angle) * centre - .12, Math.sin(angle) * centre, depth - .005); root.add(pit);
    }
    for (const [x, y, size] of [[.5, .42, .3], [.66, -.32, .18], [.2, .02, .11]] as const) {
      const star = pointedStar(4, size, size * .28, starGold); star.position.set(x, y, 0); root.add(star);
    }
    root.rotation.set(-.08, .2, -.12); root.position.x = .12;
    return root;
  };
  const victoryEmblems = emblems.VICTORY_NATIONS.map(nation =>
    [`victory-emblem-${nation}`, () => emblems.buildVictoryEmblem(T, nation), 6.6] as const);
  for (const [name, build, distance] of [["gem", gem, 5.2], ["quest-scroll", scroll, 5], ["level-star", star, 5.4],
    ["portrait-frame", frame, 5.3], ["rally-flag", rallyFlag, 6.4], ...victoryEmblems,
    ["mode-light", sun, 5], ["mode-dark", moon, 4.9]] as const) {
    // Popup art is shown large, so the emblems render at twice the HUD icon size.
    const size = name.startsWith("victory-emblem") ? 512 : 256;
    renderer.setSize(size, size);
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight("#fff4dc", "#3d3a45", 2.2));
    const key = new T.DirectionalLight("#ffffff", 3.4); key.position.set(-3, 5, 6); scene.add(key);
    const rim = new T.DirectionalLight("#9fd2ff", 2); rim.position.set(4, 2, -3); scene.add(rim);
    const front = new T.DirectionalLight("#fff1d0", 1.6); front.position.set(.6, .8, distance); scene.add(front);
    const root = build(); scene.add(root);
    // The portrait frame faces the camera squarely so it fits the round portrait exactly.
    if (name === "portrait-frame") camera.position.set(0, 0, distance);
    else camera.position.set(.6, .8, distance);
    camera.lookAt(0, name === "portrait-frame" ? .06 : 0, 0);
    renderer.render(scene, camera);
    result[name] = renderer.domElement.toDataURL("image/png").split(",")[1]!;
    root.traverse((object: any) => object.geometry?.dispose());
  }
  return result;
};

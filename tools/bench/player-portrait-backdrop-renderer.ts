/**
 * In-page renderer of the HUD portrait backdrops (`assets/ui-
 * icons/portraits/<nation>-backdrop.webp`), shared by the exporter `tools/bench/player-portrait-
 * backdrops.ts` and the icon comparison `tests-ui/visual/ui-icons.spec.ts` (TEST-01). Runs inside
 * the page through `page.evaluate`, so it must stay self-contained (dynamic imports only).
 */
export const BACKDROP_SIZE = 256;
export const BACKDROP_NATIONS = ["roman", "viking", "nubian", "japanese"] as const;

export const renderPortraitBackdrops = async ({ nations, size }: { nations: typeof BACKDROP_NATIONS; size: number }) => {
  const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  const { GLTFLoader } = await import(/* @vite-ignore */ String("/node_modules/three/examples/jsm/loaders/GLTFLoader.js"));
  const { createFoliageAtlas } = await import(/* @vite-ignore */ String("/src/render-common/trees/foliage-atlas.ts"));
  const { createIslandTreePropMesh, getTreeVariants } = await import(/* @vite-ignore */ String("/src/render-common/props/island-trees.ts"));
  const { BROADLEAF } = await import(/* @vite-ignore */ String("/src/shared/world/tree-forms.ts"));
  const { PROP } = await import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"));
  const { FOLIAGE_SEED } = await import(/* @vite-ignore */ String("/src/app/asset-seeds.ts"));
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.outputColorSpace = T.SRGBColorSpace;
  const material = (color: string, roughness = .85) => new T.MeshStandardMaterial({ color, flatShading: true, roughness });
  const STYLE = {
    japanese: { ground: "#86a85a", sky: ["#9fc4e8", "#fbe0e6"], mountain: true },
    nubian: { ground: "#d9b77a", sky: ["#8cc3e8", "#f7d9a0"], mountain: false },
    roman: { ground: "#7da24a", sky: ["#7fb3e6", "#f6e2b8"], mountain: false },
    viking: { ground: "#5f8a4a", sky: ["#6f93b8", "#dfe7ee"], mountain: true }
  } as const;

  // The game's own island trees: one shared foliage atlas, trunks marked by uv.x < 0.
  const atlasData = createFoliageAtlas(FOLIAGE_SEED);
  const atlas = new T.DataTexture(atlasData.color, atlasData.width, atlasData.height);
  atlas.colorSpace = T.SRGBColorSpace; atlas.flipY = false; atlas.needsUpdate = true;
  atlas.magFilter = T.LinearFilter; atlas.minFilter = T.LinearMipmapLinearFilter; atlas.generateMipmaps = true;
  const treeMaterial = new T.ShaderMaterial({
    fragmentShader: `uniform sampler2D atlas; varying vec2 vUv; varying vec3 vColor; varying vec3 vNormal;
      void main() {
        // Trunks get their bark tone here (the game shades bark procedurally).
        vec4 leaf = vUv.x < 0.0 ? vec4(.34, .27, .22, 1.0) : texture2D(atlas, vUv);
        if (leaf.a < .5) discard;
        float light = .55 + .55 * max(dot(normalize(vNormal), normalize(vec3(-.4, .8, .5))), 0.0);
        gl_FragColor = vec4(vColor * leaf.rgb * light, 1.0);
        #include <colorspace_fragment>
      }`,
    side: T.DoubleSide,
    uniforms: { atlas: { value: atlas } },
    vertexShader: `attribute vec3 color; varying vec2 vUv; varying vec3 vColor; varying vec3 vNormal;
      void main() { vUv = uv; vColor = color; vNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
  });
  const gameTree = (kind: number, form: number, index: number) => {
    const variants = getTreeVariants(kind);
    const variant = Math.max(0, variants.findIndex((entry: any) => entry.stage === 5 &&
      (form < 0 || entry.form === form)));
    const mesh = createIslandTreePropMesh(kind, variant, 977 + index * 131);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new T.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("color", new T.BufferAttribute(mesh.colors, 3));
    geometry.setAttribute("uv", new T.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new T.BufferAttribute(mesh.indices, 1));
    const tree = new T.Mesh(geometry, treeMaterial);
    tree.rotation.y = index * 1.7;
    return tree;
  };
  /** Each nation's emblematic tree: sakura, pine, oak, palm. */
  const TREES = {
    japanese: (index: number) => gameTree(PROP.broadleafTree, BROADLEAF.cherry, index),
    nubian: (index: number) => gameTree(PROP.palmTree, -1, index),
    roman: (index: number) => gameTree(PROP.broadleafTree, BROADLEAF.oak, index),
    viking: (index: number) => gameTree(PROP.coniferTree, -1, index)
  } as const;

  const libraries = new Map<string, any>();
  const building = async (nation: string, id: number) => {
    if (!libraries.has(nation)) {
      const gltf = await new GLTFLoader().loadAsync(`/assets/buildings/${nation}/${nation}-library-high.glb`);
      libraries.set(nation, gltf.scene);
    }
    const model = libraries.get(nation).getObjectByName(`${nation}_${id}`);
    if (!model) throw new Error(`${nation}_${id} is missing from the library`);
    const copy = model.clone(true);
    copy.traverse((object: any) => { if (/^construction_[0-2]$|plan|scaffold/i.test(object.name)) object.visible = false; });
    return copy;
  };

  const result: Record<string, string> = {};
  for (const nation of nations) {
    const style = STYLE[nation as keyof typeof STYLE];
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight("#fff4dc", "#5a5040", 1.6));
    const sun = new T.DirectionalLight("#fff0d8", 2.6); sun.position.set(-4, 6, 5); scene.add(sun);
    const ground = new T.Mesh(new T.CircleGeometry(60, 24), material(style.ground, .95));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    if (style.mountain) for (const [x, z, radius, height] of [[-9, -30, 9, 9], [7, -34, 11, 12]] as const) {
      const mountain = new T.Mesh(new T.ConeGeometry(radius, height, 9), material("#7d8794"));
      mountain.position.set(x, height / 2, z); scene.add(mountain);
      const cap = new T.Mesh(new T.ConeGeometry(radius * .32, height * .32, 9), material("#f2f5f8", .6));
      cap.position.set(x, height * .84, z); scene.add(cap);
    }
    for (const [id, x, z, yaw] of [[4, -3.4, -8, .5], [1, .9, -11, -.15], [31, 4.4, -9, -.5]] as const) {
      const model = await building(nation, id);
      model.position.set(x, 0, z); model.rotation.y = yaw; scene.add(model);
    }
    [[-5.6, -5], [-1.6, -6.5], [2.6, -6], [6.2, -4.5], [-.4, -13], [3.4, -14]].forEach(([x, z], index) => {
      const tree = TREES[nation as keyof typeof TREES](index);
      tree.position.set(x, 0, z); tree.scale.setScalar(1 + (index % 3) * .12); scene.add(tree);
    });
    const camera = new T.PerspectiveCamera(38, 1, .1, 120);
    camera.position.set(0, 1.9, 4); camera.lookAt(0, 1.6, -8);
    renderer.render(scene, camera);
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!;
    const sky = context.createLinearGradient(0, 0, 0, size);
    sky.addColorStop(0, style.sky[0]); sky.addColorStop(.62, style.sky[1]);
    context.fillStyle = sky; context.fillRect(0, 0, size, size);
    // Shallow depth of field and a light haze push the scene behind the character.
    context.filter = "blur(2px)";
    context.drawImage(renderer.domElement, 0, 0);
    context.filter = "none";
    context.fillStyle = "rgba(255, 246, 228, .14)"; context.fillRect(0, 0, size, size);
    result[nation] = canvas.toDataURL("image/webp", .9).split(",")[1]!;
    scene.traverse((object: any) => { if (object.geometry && !object.userData.nation) object.geometry.dispose(); });
  }
  renderer.dispose();
  return result;
};

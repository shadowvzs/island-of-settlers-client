import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from "three";

import {
  beardedAxeHeadShape,
  drawCowhide,
  drawTomoe,
  khopeshBladeShape
} from "./military-equipment-parts";

/**
 * Icon-only nation shield-bearer compositions (Viking, Nubian, Japanese). The Roman icon keeps the
 * issued scutum and gladius; these give every other nation its own silhouette and painted pattern.
 */
type Paint = (context: CanvasRenderingContext2D, width: number, height: number) => void;
type Surfaces = ReturnType<typeof createSurfaces>;

const createSurfaces = () => ({
  bronze: new MeshStandardMaterial({ color: "#dba25a", metalness: 0.7, roughness: 0.26 }),
  darkWood: new MeshStandardMaterial({ color: "#4a2d18", roughness: 0.6 }),
  gold: new MeshStandardMaterial({ color: "#e2b04c", metalness: 0.9, roughness: 0.25 }),
  iron: new MeshStandardMaterial({ color: "#59606a", metalness: 0.8, roughness: 0.38 }),
  lacquer: new MeshStandardMaterial({ color: "#16110f", metalness: 0.1, roughness: 0.2 }),
  leather: new MeshStandardMaterial({ color: "#6a3a1e", roughness: 0.72 }),
  silk: new MeshStandardMaterial({ color: "#1d2240", roughness: 0.55 }),
  steel: new MeshStandardMaterial({ color: "#e4e9ee", metalness: 0.8, roughness: 0.2 }),
  wood: new MeshStandardMaterial({ color: "#9a6434", roughness: 0.6 })
});

const paintedMaterial = (width: number, height: number, paint: Paint) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d")!, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return new MeshStandardMaterial({ map: texture, roughness: 0.62 });
};

const add = (parent: Group, mesh: Mesh, position: readonly number[] = [0, 0, 0]) => {
  mesh.position.set(position[0]!, position[1]!, position[2]!);
  parent.add(mesh);
  return mesh;
};

const extruded = (
  shape: Shape,
  depth: number,
  surface: Material | Material[],
  bevel = depth * 0.3
) => {
  const geometry = new ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 32,
    depth
  });
  geometry.translate(0, 0, -depth / 2);
  return new Mesh(geometry, surface);
};

/** A shallow dome facing +Z; canvas x runs around the rim, canvas y from the centre outwards. */
const domedDisc = (radius: number, surface: Material) => {
  const geometry = new SphereGeometry(radius * 2.4, 64, 16, 0, Math.PI * 2, 0, Math.asin(1 / 2.4));
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, -radius * 2.4 * Math.cos(Math.asin(1 / 2.4)));
  return new Mesh(geometry, surface);
};

/** Height of the dome surface above the rim plane at a distance from the centre. */
const domeHeight = (radius: number, distance: number) => {
  const sphere = radius * 2.4;
  return Math.sqrt(sphere * sphere - distance * distance) - sphere * Math.cos(Math.asin(1 / 2.4));
};

const paintVikingBoards: Paint = (context, width, height) => {
  for (let segment = 0; segment < 8; segment++) {
    context.fillStyle = segment % 2 ? "#e8d9b4" : "#b3261e";
    context.fillRect((segment * width) / 8, 0, width / 8 + 1, height);
  }
  context.fillStyle = "#00000022";
  for (let board = 0; board < 24; board++) context.fillRect((board * width) / 24, 0, 2, height);
  context.fillStyle = "#2b1b12";
  context.fillRect(0, height * 0.2, width, height * 0.05);
};

/** Viking: painted linden round shield with iron boss, rawhide rim and rivets, and a bearded axe. */
const createVikingSet = (surfaces: Surfaces) => {
  const root = new Group(),
    radius = 0.3;
  const paint = paintedMaterial(512, 128, paintVikingBoards);
  add(root, domedDisc(radius, paint));
  const rim = add(
    root,
    new Mesh(new TorusGeometry(radius, 0.016, 10, 64), surfaces.leather),
    [0, 0, -0.02]
  );
  rim.scale.z = 1.4;
  const boss = add(
    root,
    new Mesh(new SphereGeometry(0.075, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), surfaces.iron),
    [0, 0, domeHeight(radius, 0) - 0.01]
  );
  boss.rotation.x = Math.PI / 2;
  const flange = add(root, new Mesh(new CylinderGeometry(0.095, 0.095, 0.012, 32), surfaces.iron), [
    0,
    0,
    domeHeight(radius, 0.095)
  ]);
  flange.rotation.x = Math.PI / 2;
  for (let rivet = 0; rivet < 16; rivet++) {
    const angle = (rivet / 16) * Math.PI * 2;
    add(root, new Mesh(new SphereGeometry(0.011, 10, 6), surfaces.iron), [
      Math.cos(angle) * (radius - 0.03),
      Math.sin(angle) * (radius - 0.03),
      domeHeight(radius, radius - 0.03)
    ]);
  }
  const axe = new Group();
  axe.position.set(0.2, -0.05, -0.06);
  axe.rotation.z = -0.55;
  root.add(axe);
  add(axe, new Mesh(new CylinderGeometry(0.016, 0.02, 0.78, 14), surfaces.wood));
  add(axe, extruded(beardedAxeHeadShape(), 0.014, [surfaces.iron, surfaces.steel], 0.006), [0.012, 0.32, 0]);
  return root;
};

const paintCowhide: Paint = (context, width, height) => drawCowhide(context, [0, 0, width, height]);

/** Nubian: tall oval cowhide shield on a wooden spine with laced rim, and a bronze khopesh. */
const createNubianSet = (surfaces: Surfaces) => {
  const root = new Group();
  const hide = paintedMaterial(256, 256, paintCowhide);
  const body = add(root, domedDisc(0.2, hide));
  body.scale.set(1, 1.75, 1);
  const rim = add(
    root,
    new Mesh(new TorusGeometry(0.2, 0.013, 8, 64), surfaces.leather),
    [0, 0, -0.02]
  );
  rim.scale.set(1, 1.75, 1.3);
  const spine = new CatmullRomCurve3(
    Array.from({ length: 9 }, (_, step) => {
      const y = (step / 8 - 0.5) * 0.66;
      return new Vector3(0, y, domeHeight(0.2, Math.abs(y) / 1.75) + 0.006);
    })
  );
  const stave = add(root, new Mesh(new TubeGeometry(spine, 24, 0.016, 8), surfaces.darkWood));
  stave.scale.x = 1.4;
  for (let lace = 0; lace < 22; lace++) {
    const angle = (lace / 22) * Math.PI * 2;
    const stitch = add(root, new Mesh(new BoxGeometry(0.008, 0.03, 0.02), surfaces.leather), [
      Math.cos(angle) * 0.185,
      Math.sin(angle) * 0.185 * 1.75,
      domeHeight(0.2, 0.185)
    ]);
    stitch.rotation.z = angle;
  }
  const sword = new Group();
  sword.position.set(0.12, -0.32, -0.06);
  sword.rotation.z = -0.25;
  root.add(sword);
  add(sword, extruded(khopeshBladeShape(), 0.014, [surfaces.bronze, surfaces.gold], 0.006), [0, 0.12, 0]);
  add(sword, new Mesh(new CylinderGeometry(0.02, 0.02, 0.14, 12), surfaces.darkWood), [0, 0.05, 0]);
  add(sword, new Mesh(new SphereGeometry(0.026, 14, 10), surfaces.gold), [0, -0.025, 0]);
  return root;
};

const paintTate: Paint = (context, width, height) => {
  context.fillStyle = "#5a3a22";
  context.fillRect(0, 0, width, height);
  for (let board = 0; board < 3; board++) {
    context.fillStyle = board % 2 ? "#6a4528" : "#634024";
    context.fillRect((board * width) / 3 + 3, 0, width / 3 - 6, height);
  }
  drawTomoe(context, [width / 2, height * 0.42], width * 0.3, { commas: "#b51f24", field: "#f3ead6" });
};

/** Japanese: wrapped-hilt katana with a round tsuba over a planked tate shield bearing a tomoe mon. */
const createJapaneseSet = (surfaces: Surfaces) => {
  const root = new Group();
  const front = paintedMaterial(192, 320, paintTate);
  add(
    root,
    new Mesh(new BoxGeometry(0.36, 0.6, 0.035), [
      surfaces.darkWood,
      surfaces.darkWood,
      surfaces.darkWood,
      surfaces.darkWood,
      front,
      surfaces.darkWood
    ])
  );
  for (const y of [-0.31, 0.31])
    add(root, new Mesh(new BoxGeometry(0.38, 0.04, 0.05), surfaces.lacquer), [0, y, 0]);
  for (const y of [-0.16, 0.2])
    add(root, new Mesh(new BoxGeometry(0.37, 0.018, 0.045), surfaces.iron), [0, y, 0.002]);
  const blade = new Shape();
  blade.moveTo(-0.02, 0);
  blade.lineTo(0.02, 0);
  blade.quadraticCurveTo(0.04, 0.4, -0.03, 0.78);
  blade.lineTo(-0.06, 0.73);
  blade.quadraticCurveTo(-0.005, 0.4, -0.02, 0);
  blade.closePath();
  const katana = new Group();
  katana.position.set(0.06, -0.34, 0.06);
  katana.rotation.z = -0.62;
  root.add(katana);
  add(katana, extruded(blade, 0.006, [surfaces.steel, surfaces.steel], 0.003), [0, 0.06, 0]);
  add(katana, new Mesh(new BoxGeometry(0.034, 0.03, 0.016), surfaces.gold), [0, 0.06, 0]);
  const tsuba = add(
    katana,
    new Mesh(new CylinderGeometry(0.05, 0.05, 0.012, 24), surfaces.iron),
    [0, 0.035, 0]
  );
  tsuba.scale.z = 0.8;
  add(katana, new Mesh(new CylinderGeometry(0.018, 0.02, 0.2, 12), surfaces.silk), [0, -0.075, 0]);
  for (let wrap = 0; wrap < 7; wrap++) {
    const diamond = add(katana, new Mesh(new BoxGeometry(0.016, 0.012, 0.042), surfaces.steel), [
      0,
      -0.155 + wrap * 0.027,
      0
    ]);
    diamond.rotation.y = Math.PI / 4;
    diamond.scale.x = 0.4;
  }
  add(
    katana,
    new Mesh(new CylinderGeometry(0.021, 0.021, 0.014, 12), surfaces.gold),
    [0, -0.18, 0]
  );
  return root;
};

const builders: Record<string, (surfaces: Surfaces) => Group> = {
  japanese: createJapaneseSet,
  nubian: createNubianSet,
  viking: createVikingSet
};

export const hasNationShieldIcon = (nation: string) => nation in builders;

/** Builds the composition; the caller's traversal disposes materials and the listed painted textures. */
export const createNationShieldIcon = (nation: string) => {
  const root = builders[nation]!(createSurfaces());
  const textures = new Set<Texture>();
  root.traverse((object) => {
    const map =
      object instanceof Mesh && !Array.isArray(object.material) ? object.material.map : undefined;
    if (map) textures.add(map);
  });
  root.userData.localTextures = [...textures];
  root.rotation.y = -0.15;
  return root;
};

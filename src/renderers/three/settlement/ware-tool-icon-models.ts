import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Path,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from "three";

import { createSpyglassIconModel } from "./spyglass-icon-model";
import {
  addGripWrap,
  addHandle,
  addRivet,
  createSurfaces,
  extrude,
  outline,
  place,
  type Point,
  type Surfaces,
  trace
} from "./ware-tool-icon-kit";
import { TRADE_TOOL_BUILDERS } from "./ware-tool-icon-trade-models";

/**
 * Icon-only tool and boat models with their own detail budget: the shared carried-ware recipes stay
 * cheap for the world, while the inventory icons get distinct, readable silhouettes.
 */
/** Butcher's cleaver: a tall rectangular blade with a hanging hole and a short round riveted handle. */
const createCleaver = (surfaces: Surfaces) => {
  const root = new Group();
  const blade = outline([
    [0, -0.02],
    [0.66, -0.06],
    [0.7, 0.02],
    [0.7, 0.38],
    [0, 0.4]
  ]);
  blade.holes.push(new Path().absarc(0.57, 0.3, 0.05, 0, Math.PI * 2, true));
  place(root, extrude(blade, 0.022, 0.006), [surfaces.steel, surfaces.edge], [0, -0.2]);
  const edge = place(
    root,
    new CylinderGeometry(0.008, 0.008, 0.7, 6),
    surfaces.edge,
    [0.35, -0.225]
  );
  edge.rotation.z = Math.PI / 2 + 0.057;
  const bolster = place(
    root,
    new CylinderGeometry(0.05, 0.045, 0.07, 18),
    surfaces.steel,
    [-0.03, 0]
  );
  bolster.rotation.z = Math.PI / 2;
  const grip = new Group();
  grip.rotation.z = Math.PI / 2;
  grip.position.x = -0.22;
  root.add(grip);
  addHandle(grip, surfaces, 0.32, 0.052, 0);
  for (const y of [-0.09, 0, 0.09]) addRivet(grip, surfaces.brass, 0, y, 0.016, 0.05);
  root.rotation.z = 0.5;
  return root;
};

/** Claw hammer: a heavy forged head with octagonal striking face, split curved claw and a wrapped haft. */
const createHammer = (surfaces: Surfaces) => {
  const root = new Group();
  addHandle(root, surfaces, 0.66, 0.038, -0.02);
  addGripWrap(root, surfaces.leather, 0.041, -0.3, 6);
  const head = place(root, new CylinderGeometry(0.1, 0.1, 0.3, 8), surfaces.steel, [0.09, 0.36]);
  head.rotation.z = Math.PI / 2;
  const face = place(
    root,
    new CylinderGeometry(0.118, 0.108, 0.08, 8),
    surfaces.edge,
    [0.27, 0.36]
  );
  face.rotation.z = Math.PI / 2;
  const eye = place(root, new CylinderGeometry(0.092, 0.092, 0.2, 12), surfaces.steel, [0, 0.36]);
  eye.rotation.y = Math.PI / 8;
  for (const side of [-1, 1]) {
    const claw = new CatmullRomCurve3([
      new Vector3(-0.06, 0.37, side * 0.03),
      new Vector3(-0.2, 0.35, side * 0.04),
      new Vector3(-0.32, 0.28, side * 0.05),
      new Vector3(-0.37, 0.17, side * 0.055)
    ]);
    place(root, new TubeGeometry(claw, 16, 0.042, 10), surfaces.steel, [0, 0]);
  }
  root.rotation.z = -0.35;
  return root;
};

const sawBlade = () => {
  const points: Point[] = [
    [0, 0.2],
    [0.82, 0.1]
  ];
  const teeth = 24;
  for (let tooth = 0; tooth <= teeth; tooth++) {
    const x = 0.82 - (tooth / teeth) * 0.82,
      bottom = -0.01 - (tooth / teeth) * 0.03;
    points.push([x, bottom + (tooth % 2 ? -0.035 : 0)]);
  }
  return outline(points);
};

/** Panel saw: tapered blade with a full row of teeth and a closed pistol-grip handle. */
const createSaw = (surfaces: Surfaces) => {
  const root = new Group();
  place(root, extrude(sawBlade(), 0.012, 0.003), [surfaces.steel, surfaces.edge], [0, 0]);
  const handle = outline([
    [-0.3, -0.06],
    [-0.05, -0.08],
    [0.05, 0.02],
    [0.06, 0.26],
    [-0.04, 0.3],
    [-0.32, 0.24],
    [-0.36, 0.1]
  ]);
  handle.holes.push(
    trace(
      [
        [-0.24, 0.02],
        [-0.08, 0.01],
        [-0.03, 0.07],
        [-0.04, 0.2],
        [-0.24, 0.19],
        [-0.28, 0.1]
      ],
      new Path()
    )
  );
  place(root, extrude(handle, 0.06, 0.018), surfaces.wood, [0, 0]);
  for (const [x, y] of [
    [0.01, 0.2],
    [0.02, 0.05]
  ] as const)
    addRivet(root, surfaces.brass, x, y, 0.02, 0.045);
  root.rotation.z = 0.15;
  return root;
};

/** Spade blade dished towards the viewer so the polished steel catches the light. */
const spadeBlade = () => {
  const blade = outline([
    [-0.2, 0.12],
    [0.2, 0.12],
    [0.21, -0.2],
    [0.13, -0.33],
    [0, -0.39],
    [-0.13, -0.33],
    [-0.21, -0.2]
  ]);
  const geometry = extrude(blade, 0.02, 0.006);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    position.setZ(index, position.getZ(index) - x * x * 0.9);
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** Crescent pick head: thick at the eye, tapering to a point and a chisel tip. */
const pickHead = () => {
  const head = new Shape();
  head.moveTo(-0.46, -0.1);
  head.quadraticCurveTo(-0.25, 0.06, 0, 0.1);
  head.quadraticCurveTo(0.25, 0.06, 0.46, -0.08);
  head.lineTo(0.47, -0.13);
  head.quadraticCurveTo(0.24, -0.02, 0, -0.03);
  head.quadraticCurveTo(-0.24, -0.04, -0.44, -0.14);
  head.closePath();
  return extrude(head, 0.07, 0.022);
};

/** Miner's pickaxe: a bold forged steel head on a collared ash haft with a leather grip. */
const createPickaxe = (surfaces: Surfaces) => {
  const root = new Group();
  addHandle(root, surfaces, 0.74, 0.036, -0.03);
  addGripWrap(root, surfaces.leather, 0.039, -0.34, 5);
  place(root, pickHead(), [surfaces.steel, surfaces.edge], [0, 0.37]);
  place(root, new CylinderGeometry(0.062, 0.062, 0.14, 8), surfaces.iron, [0, 0.36]);
  root.rotation.z = -0.3;
  return root;
};

/** Long-handled shovel: a large steel spade, riveted socket, wooden haft and a T grip. */
const createShovel = (surfaces: Surfaces) => {
  const root = new Group();
  place(root, spadeBlade(), [surfaces.steel, surfaces.edge], [0, -0.18]);
  place(root, new CylinderGeometry(0.04, 0.07, 0.2, 16), surfaces.steel, [0, 0.02, -0.01]);
  addRivet(root, surfaces.brass, 0, 0.02, 0.014, 0.055);
  addHandle(root, surfaces, 0.5, 0.032, 0.37);
  const grip = place(root, new CylinderGeometry(0.03, 0.03, 0.2, 14), surfaces.darkWood, [0, 0.64]);
  grip.rotation.z = Math.PI / 2;
  root.rotation.z = -0.3;
  return root;
};

const tongArm = (side: number) =>
  new CatmullRomCurve3([
    new Vector3(side * 0.24, -0.58, 0),
    new Vector3(side * 0.13, -0.1, 0),
    new Vector3(0, 0.3, side * 0.03),
    new Vector3(-side * 0.1, 0.48, side * 0.03),
    new Vector3(-side * 0.09, 0.62, side * 0.03),
    new Vector3(-side * 0.045, 0.68, side * 0.03)
  ]);

/** Smith's tongs: two bold crossing reins on a pivot rivet, gripping a glowing iron billet. */
const createTongs = (surfaces: Surfaces) => {
  const root = new Group();
  for (const side of [-1, 1]) {
    const arm = place(root, new TubeGeometry(tongArm(side), 48, 0.05, 12), surfaces.iron, [0, 0]);
    arm.scale.z = 0.75;
    const end = place(root, new SphereGeometry(0.058, 16, 10), surfaces.iron, [side * 0.24, -0.58]);
    end.scale.y = 1.3;
  }
  const pivot = place(root, new CylinderGeometry(0.075, 0.075, 0.16, 18), surfaces.steel, [0, 0.3]);
  pivot.rotation.x = Math.PI / 2;
  const billet = place(
    root,
    new CylinderGeometry(0.06, 0.06, 0.34, 6),
    surfaces.glow,
    [0, 0.7, 0.03]
  );
  billet.rotation.x = Math.PI / 2;
  return root;
};

const plankTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  for (let plank = 0; plank < 8; plank++) {
    context.fillStyle = plank % 2 ? "#9c6535" : "#b07440";
    context.fillRect(0, plank * 32, 64, 32);
    context.fillStyle = "#4a2c16";
    context.fillRect(0, plank * 32, 64, 3);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
};

const SHEER = 0.08;
/** Hull half-width at a position along the keel (-1 stern .. 1 bow): pointed at both ends. */
const hullWidth = (x: number) => 0.24 * (1 - Math.abs(x) ** 2.2);

/** Planked hull: the lower hemisphere narrowed to pointed ends, with a raised sheer at bow and stern. */
const hullGeometry = () => {
  const geometry = new SphereGeometry(1, 48, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index),
      y = position.getY(index),
      z = position.getZ(index);
    const section = Math.max(0.001, Math.sqrt(1 - x * x));
    position.setXYZ(
      index,
      x * 0.62,
      y * 0.26 + SHEER * x * x * (1 + y),
      (z / section) * hullWidth(x)
    );
  }
  geometry.computeVertexNormals();
  return geometry;
};

const gunwaleCurve = (side: number) => {
  const points: Vector3[] = [];
  for (let step = 0; step <= 24; step++) {
    const x = -1 + step / 12;
    points.push(new Vector3(x * 0.62, SHEER * x * x + 0.005, side * hullWidth(x)));
  }
  return new CatmullRomCurve3(points);
};

/** Inner ribs: half rings following the hull section at several stations. */
const addRibs = (parent: Group, surface: Material) => {
  for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const width = hullWidth(x);
    const rib = place(parent, new TorusGeometry(1, 0.05, 6, 20, Math.PI), surface, [
      x * 0.62,
      SHEER * x * x + 0.2
    ]);
    rib.rotation.set(Math.PI, Math.PI / 2, 0);
    rib.scale.set(width * 0.95, 0.24, 0.25);
  }
};

const addOar = (parent: Group, surfaces: Surfaces, z: number) => {
  const oar = new Group();
  oar.position.set(0.05, 0.25, z);
  oar.rotation.set(0.1, 0, Math.PI / 2 + 0.06);
  place(oar, new CylinderGeometry(0.014, 0.014, 0.9, 10), surfaces.wood, [0, 0]);
  const blade = place(oar, new SphereGeometry(1, 16, 8), surfaces.wood, [0, -0.48]);
  blade.scale.set(0.055, 0.14, 0.012);
  parent.add(oar);
};

/** Rowing boat: planked hull, dark gunwales and keel, ribs, two thwarts and a pair of shipped oars. */
const createBoat = (surfaces: Surfaces) => {
  const root = new Group();
  const planks = new MeshStandardMaterial({
    map: plankTexture(),
    roughness: 0.66,
    side: DoubleSide
  });
  place(root, hullGeometry(), planks, [0, 0.2]);
  for (const side of [-1, 1])
    place(root, new TubeGeometry(gunwaleCurve(side), 48, 0.02, 8), surfaces.darkWood, [0, 0.2]);
  addRibs(root, surfaces.darkWood);
  for (const x of [-0.2, 0.18])
    place(root, new BoxGeometry(0.07, 0.022, hullWidth(x / 0.62) * 2), surfaces.wood, [x, 0.17]);
  place(
    root,
    new TubeGeometry(
      new CatmullRomCurve3([
        new Vector3(-0.64, 0.3, 0),
        new Vector3(-0.4, 0, 0),
        new Vector3(0.4, 0, 0),
        new Vector3(0.64, 0.3, 0)
      ]),
      32,
      0.018,
      6
    ),
    surfaces.darkWood,
    [0, 0]
  );
  addOar(root, surfaces, 0.07);
  addOar(root, surfaces, -0.07);
  return { planks, root };
};

const toolBuilders: Record<string, (surfaces: Surfaces) => Group> = {
  ...TRADE_TOOL_BUILDERS,
  cleaver: createCleaver,
  hammer: createHammer,
  pickaxe: createPickaxe,
  saw: createSaw,
  shovel: createShovel,
  tongs: createTongs
};

export const ICON_TOOL_WARES = new Set(["boat", "spyglass", ...Object.keys(toolBuilders)]);

/** Upright tools face the icon camera; the boat rests on its keel. */
export const createToolIconModel = (id: string) => {
  if (id === "spyglass") return createSpyglassIconModel();
  const surfaces = createSurfaces();
  const owned: Material[] = Object.values(surfaces);
  const root = new Group();
  root.name = `ware_icon_${id}`;
  if (id === "boat") {
    const boat = createBoat(surfaces);
    owned.push(boat.planks);
    root.add(boat.root);
    root.rotation.y = 0.3;
  } else {
    root.add(toolBuilders[id]!(surfaces));
    root.rotation.y = 0.63;
  }
  const meshes = () => {
    const found: Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof Mesh) found.push(object);
    });
    return found;
  };
  const triangles = () =>
    meshes().reduce(
      (count, mesh) =>
        count + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3,
      0
    );
  const dispose = () => {
    meshes().forEach((mesh) => mesh.geometry.dispose());
    owned.forEach((surface) => {
      (surface as MeshStandardMaterial).map?.dispose();
      surface.dispose();
    });
    root.removeFromParent();
  };
  // The boat fills the icon edge to edge; its soft shadow may run off the canvas.
  const boat = id === "boat";
  const recipe = {
    framingMargin: boat ? 1.02 : 1.06,
    framingShadow: !boat && id !== "shovel",
    tightFraming: true,
    tool: false
  };
  return { dispose, recipe, root, triangles };
};

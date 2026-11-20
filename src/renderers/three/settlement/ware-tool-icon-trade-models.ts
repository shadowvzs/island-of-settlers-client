import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3
} from "three";

import {
  addGripWrap,
  addHandle,
  extrude,
  outline,
  place,
  type Surfaces
} from "./ware-tool-icon-kit";

/**
 * Icon-only models of the trade tools (axe, scythe, sword, fishing rod, rolling pin): bold metal
 * parts and chunky wood so each silhouette still reads at the 32 px inventory size.
 */

/** Thins an extruded blade towards its cutting edge (x beyond `from`), keeping the eye thick. */
const taperTowardsEdge = (geometry: ReturnType<typeof extrude>, from: number, to: number) => {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const reach = Math.min(1, Math.max(0, (position.getX(index) - from) / (to - from)));
    position.setZ(index, position.getZ(index) * (1 - reach * 0.75));
  }
  geometry.computeVertexNormals();
  return geometry;
};

const axeHead = () => {
  const head = new Shape();
  head.moveTo(-0.12, 0.24);
  head.lineTo(-0.12, 0.42);
  head.lineTo(0.08, 0.44);
  head.quadraticCurveTo(0.22, 0.47, 0.38, 0.58);
  head.quadraticCurveTo(0.52, 0.32, 0.38, 0.04);
  head.quadraticCurveTo(0.2, 0.17, 0.08, 0.21);
  head.closePath();
  return taperTowardsEdge(extrude(head, 0.09, 0.022), 0.06, 0.44);
};

/** Felling axe: a broad bearded steel head with a bright edge on a long wedged haft. */
const createAxe = (surfaces: Surfaces) => {
  const root = new Group();
  addHandle(root, surfaces, 0.84, 0.042, 0);
  addGripWrap(root, surfaces.leather, 0.045, -0.36, 5);
  place(root, axeHead(), [surfaces.steel, surfaces.edge], [0, 0]);
  place(root, new CylinderGeometry(0.068, 0.068, 0.24, 8), surfaces.iron, [0, 0.33]);
  place(root, new BoxGeometry(0.03, 0.04, 0.09), surfaces.darkWood, [0, 0.46]);
  root.rotation.z = -0.3;
  return root;
};

const scytheBlade = () => {
  const blade = new Shape();
  blade.moveTo(0.1, 0.6);
  blade.quadraticCurveTo(-0.3, 0.74, -0.78, 0.4);
  blade.quadraticCurveTo(-0.32, 0.54, 0.08, 0.46);
  blade.closePath();
  return extrude(blade, 0.028, 0.01);
};

/** Mower's scythe: a wide curved blade with a raised spine on a bent snath with two grips. */
const createScythe = (surfaces: Surfaces) => {
  const root = new Group();
  const snath = new CatmullRomCurve3([
    new Vector3(0.04, -0.52, 0),
    new Vector3(-0.03, -0.1, 0),
    new Vector3(0, 0.3, 0),
    new Vector3(0.07, 0.54, 0)
  ]);
  place(root, new TubeGeometry(snath, 32, 0.036, 12), surfaces.wood, [0, 0]);
  for (const y of [-0.22, 0.18]) {
    const grip = place(root, new CylinderGeometry(0.03, 0.034, 0.2, 14), surfaces.darkWood, [
      0.09,
      y
    ]);
    grip.rotation.z = -Math.PI / 2 + 0.4;
  }
  place(root, scytheBlade(), [surfaces.steel, surfaces.edge], [0, 0]);
  const spine = new CatmullRomCurve3([
    new Vector3(0.08, 0.6, 0),
    new Vector3(-0.32, 0.67, 0),
    new Vector3(-0.74, 0.42, 0)
  ]);
  place(root, new TubeGeometry(spine, 32, 0.02, 8), surfaces.iron, [0, 0]);
  const collar = place(root, new TorusGeometry(0.045, 0.018, 8, 20), surfaces.iron, [0.07, 0.5]);
  collar.rotation.x = Math.PI / 2;
  root.rotation.z = 0.12;
  return root;
};

/** Arming sword: a broad fullered blade, brass cross guard, wrapped grip and round pommel. */
const createSword = (surfaces: Surfaces) => {
  const root = new Group();
  const blade = outline([
    [-0.075, 0],
    [0.075, 0],
    [0.068, 0.5],
    [0, 0.66],
    [-0.068, 0.5]
  ]);
  place(root, extrude(blade, 0.024, 0.012), [surfaces.steel, surfaces.edge], [0, 0]);
  for (const side of [-1, 1])
    place(root, new BoxGeometry(0.03, 0.44, 0.006), surfaces.iron, [0, 0.27, side * 0.025]);
  place(root, new BoxGeometry(0.34, 0.055, 0.09), surfaces.brass, [0, -0.02]);
  for (const side of [-1, 1])
    place(root, new SphereGeometry(0.042, 16, 10), surfaces.brass, [side * 0.17, -0.02]);
  place(root, new CylinderGeometry(0.038, 0.042, 0.2, 16), surfaces.leather, [0, -0.15]);
  addGripWrap(root, surfaces.darkWood, 0.041, -0.22, 5);
  const pommel = place(root, new SphereGeometry(0.065, 20, 14), surfaces.brass, [0, -0.29]);
  pommel.scale.y = 0.8;
  root.rotation.z = -0.62;
  return root;
};

const ROD_CURVE = new CatmullRomCurve3([
  new Vector3(-0.12, -0.5, 0),
  new Vector3(-0.04, -0.05, 0),
  new Vector3(0.1, 0.32, 0),
  new Vector3(0.36, 0.58, 0)
]);

/** Tapered rod built from short cylinders along its bend (thick butt, fine tip). */
const addRodBlank = (parent: Group, surfaces: Surfaces) => {
  const segments = 14;
  for (let step = 0; step < segments; step++) {
    const t = (step + 0.5) / segments,
      radius = 0.05 - t * 0.032;
    const segment = place(
      parent,
      new CylinderGeometry(radius * 0.94, radius, 1.2 / segments, 14),
      t < 0.3 ? surfaces.cork : surfaces.darkWood,
      ROD_CURVE.getPoint(t).toArray()
    );
    segment.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), ROD_CURVE.getTangent(t));
  }
  for (const t of [0.3, 0.55, 0.75, 0.92]) {
    const guide = place(parent, new TorusGeometry(0.034, 0.01, 8, 16), surfaces.brass, [
      ...ROD_CURVE.getPoint(t).toArray()
    ]);
    guide.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), ROD_CURVE.getTangent(t));
  }
};

/** Brass reel on a foot below the cork grip, with a crank knob. */
const addReel = (parent: Group, surfaces: Surfaces) => {
  const reel = new Group();
  reel.position.set(0.0, -0.3, 0);
  parent.add(reel);
  const drum = place(reel, new CylinderGeometry(0.13, 0.13, 0.07, 28), surfaces.brass, [0.13, 0]);
  drum.rotation.x = Math.PI / 2;
  const spool = place(reel, new CylinderGeometry(0.08, 0.08, 0.076, 24), surfaces.iron, [0.13, 0]);
  spool.rotation.x = Math.PI / 2;
  place(reel, new BoxGeometry(0.09, 0.04, 0.04), surfaces.brass, [0.03, 0.02]);
  place(reel, new SphereGeometry(0.034, 12, 8), surfaces.darkWood, [0.21, -0.05, 0.06]);
};

/** Red and white cork float on the line, with a hook below. */
const addFloat = (parent: Group, surfaces: Surfaces, top: Vector3) => {
  const float = new Vector3(top.x + 0.06, -0.08, 0.02);
  const line = new CatmullRomCurve3([top, new Vector3(top.x + 0.05, 0.2, 0.01), float]);
  place(parent, new TubeGeometry(line, 24, 0.004, 5), surfaces.edge, [0, 0]);
  const upper = place(
    parent,
    new SphereGeometry(0.095, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    surfaces.enamel,
    float.toArray()
  );
  upper.scale.y = 1.3;
  const lower = place(
    parent,
    new SphereGeometry(0.095, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    surfaces.edge,
    float.toArray()
  );
  lower.scale.y = 1.3;
  place(parent, new CylinderGeometry(0.012, 0.012, 0.08, 8), surfaces.enamel, [
    float.x,
    float.y + 0.15,
    float.z
  ]);
  const hook = place(
    parent,
    new TorusGeometry(0.035, 0.008, 6, 16, Math.PI * 1.4),
    surfaces.steel,
    [float.x, float.y - 0.2, float.z]
  );
  hook.rotation.z = Math.PI;
};

/** Fishing rod: a bent two-tone rod with cork grip, brass guides and reel, line and float. */
const createFishingRod = (surfaces: Surfaces) => {
  const root = new Group();
  addRodBlank(root, surfaces);
  addReel(root, surfaces);
  addFloat(root, surfaces, ROD_CURVE.getPoint(1));
  return root;
};

const PIN_BARREL = [
  [0, -0.32],
  [0.1, -0.32],
  [0.122, -0.29],
  [0.13, -0.2],
  [0.132, 0],
  [0.13, 0.2],
  [0.122, 0.29],
  [0.1, 0.32],
  [0, 0.32]
].map(([radius, height]) => new Vector2(radius!, height!));

/** Rolling pin: a fat maple barrel on brass collars with turned dark handles, lying on its side. */
const createRollingPin = (surfaces: Surfaces) => {
  const root = new Group();
  const pin = new Group();
  pin.rotation.z = Math.PI / 2;
  pin.position.y = 0.132;
  // Turned towards the camera so the fat barrel reads diagonally instead of as a thin bar.
  root.rotation.y = -1.05;
  root.add(pin);
  place(pin, new LatheGeometry(PIN_BARREL, 40), surfaces.maple, [0, 0]);
  for (const end of [-1, 1]) {
    const collar = place(pin, new TorusGeometry(0.05, 0.016, 8, 20), surfaces.brass, [
      0,
      end * 0.335
    ]);
    collar.rotation.x = Math.PI / 2;
    place(pin, new CylinderGeometry(0.045, 0.05, 0.16, 16), surfaces.darkWood, [0, end * 0.42]);
    place(pin, new SphereGeometry(0.062, 18, 12), surfaces.darkWood, [0, end * 0.52]);
  }
  return root;
};

export const TRADE_TOOL_BUILDERS: Record<string, (surfaces: Surfaces) => Group> = {
  axe: createAxe,
  fishingRod: createFishingRod,
  rollingPin: createRollingPin,
  scythe: createScythe,
  sword: createSword
};

import {
  CatmullRomCurve3,
  Group,
  LatheGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3
} from "three";

import { group, paintedMaterial, put } from "./ui-action-icon-kit";

/**
 * Market: an original polished brass balance scale (finial, turned column, curved beam with ball
 * ends, two shallow pans each hung by three chains, stepped round base) with light wear.
 */
type Profile = readonly (readonly [number, number])[];

const BEAM_END_X = 0.86;
const BEAM_END_Y = 1.5;
const PAN_Y = 0.56;
const PAN_RADIUS = 0.37;
const CHAIN_TOP_Y = BEAM_END_Y - 0.13;
/** Three chains per pan, evenly spaced around the rim (one on the outer side). */
const CHAIN_ANGLES = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3] as const;
/** Turns the beam almost square to the default icon camera, keeping a hint of depth. */
const FACING_TURN = 0.2;

/** Worn brass: warm base with darker tarnish blotches and fine light scratches. */
const paintWornBrass = (context: CanvasRenderingContext2D, width: number, height: number) => {
  context.fillStyle = "#c4822f";
  context.fillRect(0, 0, width, height);
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let index = 0; index < 90; index++) {
    context.fillStyle = `rgba(78,44,12,${0.06 + random() * 0.1})`;
    context.beginPath();
    context.ellipse(random() * width, random() * height, 4 + random() * 14, 3 + random() * 8,
      random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  context.lineWidth = 0.7;
  for (let index = 0; index < 60; index++) {
    const x = random() * width, y = random() * height, length = 4 + random() * 12;
    context.strokeStyle = `rgba(255,232,170,${0.12 + random() * 0.18})`;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length * (random() - 0.5), y + length * (random() - 0.5));
    context.stroke();
  }
};

const brassMaterials = () => {
  const worn = paintedMaterial(128, 128, paintWornBrass, 0.3);
  worn.metalness = 0.9;
  const polished = new MeshStandardMaterial({ color: "#da963a", metalness: 0.92, roughness: 0.22 });
  const shadowed = new MeshStandardMaterial({ color: "#8f5c22", metalness: 0.9, roughness: 0.38 });
  return { polished, shadowed, worn };
};

const lathe = (profile: Profile, segments = 48) =>
  new LatheGeometry(profile.map(([radius, y]) => new Vector2(radius, y)), segments);

/** Stepped round foot: wide bevelled plinth, a second step and a bell collar. */
const BASE_PROFILE: Profile = [
  [0, 0], [0.56, 0], [0.6, 0.03], [0.6, 0.09], [0.53, 0.15], [0.42, 0.17], [0.41, 0.21],
  [0.38, 0.24], [0.31, 0.25], [0.3, 0.29], [0.27, 0.31], [0.2, 0.33], [0.17, 0.38], [0.15, 0.43],
  [0.18, 0.45], [0.18, 0.49], [0.13, 0.51], [0, 0.51]
];

/** Turned column: baluster swell, ring mouldings and a slim neck up to the pivot. */
const COLUMN_PROFILE: Profile = [
  [0, 0.5], [0.12, 0.5], [0.13, 0.55], [0.17, 0.66], [0.19, 0.76], [0.17, 0.87], [0.12, 0.97],
  [0.09, 1.05], [0.085, 1.1], [0.13, 1.12], [0.14, 1.16], [0.11, 1.19], [0.08, 1.21], [0.075, 1.4],
  [0, 1.4]
];

/** Upper column: collars above the hub and an acorn finial. */
const CROWN_PROFILE: Profile = [
  [0, 1.6], [0.09, 1.6], [0.1, 1.63], [0.07, 1.66], [0.065, 1.73], [0.11, 1.75], [0.11, 1.79],
  [0.06, 1.81], [0.05, 1.84], [0.095, 1.89], [0.1, 1.95], [0.075, 2.02], [0.035, 2.08], [0, 2.11]
];

/** Shallow pan: rolled rim, flared bowl and a small foot ring underneath. */
const PAN_PROFILE: Profile = [
  [0, -0.17], [0.13, -0.17], [0.15, -0.14], [0.21, -0.13], [0.29, -0.09], [0.35, -0.03],
  [0.37, 0.03], [0.345, 0.03], [0.32, -0.02], [0.25, -0.08], [0.12, -0.11], [0, -0.115]
];

/** Gull-wing beam: rises from the hub, then dips into the ball ends. */
const createBeam = (root: Group, surfaces: ReturnType<typeof brassMaterials>) => {
  for (const side of [-1, 1]) {
    const curve = new CatmullRomCurve3([
      new Vector3(0, 1.5, 0), new Vector3(side * 0.25, 1.57, 0), new Vector3(side * 0.52, 1.57, 0),
      new Vector3(side * 0.73, 1.52, 0), new Vector3(side * BEAM_END_X, BEAM_END_Y, 0)
    ]);
    const beam = put(root, new TubeGeometry(curve, 40, 0.058, 16), surfaces.worn);
    beam.scale.z = 0.7;
    put(root, new SphereGeometry(0.09, 28, 18), surfaces.polished,
      [side * BEAM_END_X, BEAM_END_Y, 0]);
    put(root, new TorusGeometry(0.035, 0.014, 8, 20), surfaces.polished,
      [side * BEAM_END_X, BEAM_END_Y - 0.11, 0], [0, Math.PI / 2, 0]);
  }
  put(root, new TorusGeometry(0.11, 0.028, 14, 40), surfaces.polished, [0, 1.5, 0.06]);
  put(root, new SphereGeometry(0.09, 28, 18), surfaces.polished, [0, 1.5, 0.06]);
  put(root, new TorusGeometry(0.11, 0.028, 14, 40), surfaces.polished, [0, 1.5, -0.06]);
};

/** Alternating oval links from the hook ring down to one rim anchor. */
const createChain = (root: Group, material: MeshStandardMaterial, from: Vector3, to: Vector3) => {
  const direction = to.clone().sub(from);
  const count = Math.round(direction.length() / 0.08);
  const link = new TorusGeometry(0.03, 0.012, 6, 14);
  link.scale(1, 1.45, 1);
  for (let index = 0; index < count; index++) {
    const point = from.clone().lerp(to, (index + 0.5) / count);
    const holder = group(root, [point.x, point.y, point.z]);
    holder.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
    put(holder, link, material, [0, 0, 0], [0, index % 2 ? Math.PI / 2 : 0, 0]);
  }
};

const createPan = (root: Group, surfaces: ReturnType<typeof brassMaterials>, side: number) => {
  const centre = new Vector3(side * BEAM_END_X, PAN_Y, 0);
  put(root, lathe(PAN_PROFILE), surfaces.worn, [centre.x, centre.y, centre.z]);
  put(root, new TorusGeometry(PAN_RADIUS - 0.005, 0.024, 10, 64), surfaces.polished,
    [centre.x, centre.y + 0.03, 0], [Math.PI / 2, 0, 0]);
  const hook = new Vector3(side * BEAM_END_X, CHAIN_TOP_Y, 0);
  for (const angle of CHAIN_ANGLES) {
    const anchor = new Vector3(
      centre.x + side * Math.cos(angle) * (PAN_RADIUS - 0.03),
      centre.y + 0.045,
      Math.sin(angle) * (PAN_RADIUS - 0.03)
    );
    createChain(root, surfaces.polished, hook, anchor);
  }
};

export const createBalanceScale = () => {
  const surfaces = brassMaterials();
  const root = new Group();
  put(root, lathe(BASE_PROFILE, 64), surfaces.worn);
  put(root, new TorusGeometry(0.6, 0.024, 10, 64), surfaces.shadowed, [0, 0.07, 0],
    [Math.PI / 2, 0, 0]);
  put(root, lathe(COLUMN_PROFILE), surfaces.worn);
  put(root, lathe(CROWN_PROFILE), surfaces.polished);
  put(root, new SphereGeometry(0.07, 20, 14), surfaces.shadowed, [0, 1.42, 0]);
  createBeam(root, surfaces);
  for (const side of [-1, 1]) createPan(root, surfaces, side);
  root.position.y = -1.05;
  root.rotation.y = FACING_TURN;
  return root;
};

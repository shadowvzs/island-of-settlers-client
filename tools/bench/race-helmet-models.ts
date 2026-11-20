import {
  BoxGeometry, Color, DoubleSide, ExtrudeGeometry, Group, type Material,
Mesh, MeshPhysicalMaterial, Shape, SphereGeometry,
  Vector3} from "three";

import {
  band, bend, lacquer, matte, metal, paintedTexture,   type Profile,
profilePoint, rib, ring, rivets, strands, taperedTube, turn} from "./race-helmet-parts";

/**
 * Original procedural helmets of three nations for the registration race buttons (front faces +z, the
 * rim sits at y = 0): Viking horned spangenhelm, Roman galea with crest and Japanese kabuto. The Nubian
 * feathered headband lives in race-helmet-headband.ts.
 */

const IRON = () => metal("#a6aeb5", 0.28);
const BRONZE = () => metal("#c58a3c", 0.3);
export const GOLD = () => {
  const gold = metal("#f0c25a", 0.22);
  gold.emissive.set("#5a3a08");
  gold.emissiveIntensity = 0.4;
  return gold;
};
const DARK_INSIDE = () => matte("#24180f", 0.95);

/** Dark lining just inside the rim, so the open bottom never shows the sky through the helmet. */
const lining = (profile: Profile) => {
  const inner = turn(profile.map(([radius, height]) => [radius * 0.97, height] as const), DARK_INSIDE());
  (inner.material as Material).side = DoubleSide;
  return inner;
};

const VIKING_BOWL: Profile = [[1, 0], [1.01, 0.24], [0.98, 0.5], [0.9, 0.8], [0.75, 1.08], [0.53, 1.32],
  [0.28, 1.5], [0.1, 1.58], [0, 1.6]];

/** Ivory horn curving out, up and forward, with growth rings and a darker tip. */
const vikingHorn = (side: number) => {
  const ivory = new Color("#f1e4c3"), tip = new Color("#6b4a2b");
  const material = new MeshPhysicalMaterial({ clearcoat: 0.5, clearcoatRoughness: 0.35, roughness: 0.45,
    vertexColors: true });
  const points = [[0.82, 0.62, 0], [1.25, 0.74, 0.04], [1.62, 1.02, 0.1], [1.84, 1.46, 0.18], [1.8, 1.9, 0.3],
    [1.62, 2.18, 0.42]].map(([x, y, z]) => new Vector3(x! * side, y, z));
  return taperedTube({
    colorAt: t => ivory.clone().lerp(tip, Math.pow(Math.max(0, t - 0.45) / 0.55, 1.4)),
    material,
    points,
    radiusAt: t => (0.25 * Math.pow(1 - t, 0.85) + 0.012) * (1 + Math.sin(t * 46) * 0.03 * (1 - t))
  });
};

export const vikingHelmet = () => {
  const root = new Group();
  const iron = IRON(), bronze = BRONZE();
  root.add(turn(VIKING_BOWL, iron), lining(VIKING_BOWL));
  root.add(band({ bottom: 1.03, height: 0.26, material: bronze, top: 1.025, y: 0.13 }));
  root.add(ring(1.035, 0.03, 0.01, bronze), ring(1.03, 0.03, 0.26, bronze));
  for (let index = 0; index < 4; index++) root.add(rib(VIKING_BOWL, index * Math.PI / 2 + Math.PI / 4, bronze, 0.055,
    0.12, 1));
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2 + Math.PI / 4;
    for (const fraction of [0.3, 0.5, 0.7]) {
      const head = new Mesh(new SphereGeometry(0.035, 12, 8), bronze);
      head.position.copy(profilePoint(VIKING_BOWL, fraction, angle, 0.06));
      root.add(head);
    }
  }
  root.add(rivets({ count: 28, material: iron, radius: 1.05, size: 0.03, y: 0.13 }));
  const knob = new Mesh(new SphereGeometry(0.09, 20, 14), bronze);
  knob.position.y = 1.6;
  root.add(knob);
  root.add(vikingNasal(iron));
  for (const side of [-1, 1]) {
    root.add(vikingHorn(side));
    const collar = ring(0.27, 0.05, 0, bronze);
    collar.rotation.set(0, 0, side * Math.PI / 2 - side * 0.25);
    collar.position.set(side * 0.9, 0.64, 0.01);
    root.add(collar);
  }
  return root;
};

/** Nasal bar forged onto the brow band. */
const vikingNasal = (iron: Material) => {
  const nasal = new Mesh(bend(new BoxGeometry(0.17, 0.62, 0.05, 2, 12, 1), vertex =>
    new Vector3(vertex.x * (1 - (0.31 - vertex.y) * 0.5), vertex.y, vertex.z - vertex.y * vertex.y * 0.25)), iron);
  nasal.position.set(0, -0.18, 1.05);
  return nasal;
};

const ROMAN_BOWL: Profile = [[0.95, 0], [0.97, 0.3], [0.94, 0.6], [0.83, 0.88], [0.64, 1.08], [0.36, 1.21],
  [0.12, 1.25], [0, 1.26]];

/** Hinged cheek guard: a shaped plate with an embossed boss, angled in under the jaw. */
const romanCheekGuard = (side: number, plate: Material, trim: Material) => {
  const outline = new Shape();
  outline.moveTo(-0.42, 0);
  outline.lineTo(0.36, 0);
  outline.quadraticCurveTo(0.42, -0.3, 0.2, -0.46);
  outline.quadraticCurveTo(0.08, -0.62, 0.12, -0.86);
  outline.quadraticCurveTo(-0.12, -0.9, -0.3, -0.68);
  outline.quadraticCurveTo(-0.44, -0.4, -0.42, 0);
  const geometry = bend(new ExtrudeGeometry(outline, { bevelEnabled: true, bevelSegments: 3, bevelSize: 0.02,
    bevelThickness: 0.02, curveSegments: 24, depth: 0.03 }), vertex =>
    new Vector3(vertex.x, vertex.y, vertex.z - vertex.x * vertex.x * 0.6));
  const guard = new Group();
  const mesh = new Mesh(geometry, plate);
  const boss = new Mesh(new SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), trim);
  boss.rotation.x = Math.PI / 2;
  boss.position.set(0.0, -0.38, 0.04);
  boss.scale.set(1, 0.4, 1);
  guard.add(mesh, boss);
  guard.rotation.set(0, side * Math.PI / 2, side * 0.12);
  guard.position.set(side * 0.94, 0.12, 0.28);
  return guard;
};

/** Red horsehair crest running front to back over a bronze holder. */
const romanCrest = () => {
  const group = new Group();
  const shade = [new Color("#b3121b"), new Color("#d42a22"), new Color("#8a0d14"), new Color("#e0473a")];
  const hair = new MeshPhysicalMaterial({ roughness: 0.55, sheen: 1, sheenColor: "#ff9a8a", sheenRoughness: 0.4 });
  group.add(strands({
    count: 3400,
    material: hair,
    place: (index, random) => {
      const along = (index % 260) / 259, angle = -1.95 + along * 3.45;
      const origin = new Vector3((random() - 0.5) * 0.22, 0.62 + Math.cos(angle) * 0.66, Math.sin(angle) * 0.66);
      const outward = new Vector3(0, Math.cos(angle), Math.sin(angle)).normalize();
      const droop = along < 0.2 ? (0.2 - along) * 3.5 : 0;
      const direction = outward.add(new Vector3((random() - 0.5) * 0.25, -droop, -droop * 0.3));
      const length = (0.78 + random() * 0.18) * (1 - Math.pow(Math.abs(along - 0.45), 2) * 0.8) + droop * 0.6;
      return { color: shade[Math.floor(random() * shade.length)]!, direction, length, origin, width: 0.034 };
    }
  }));
  const holder = new Mesh(new BoxGeometry(0.14, 0.14, 0.9), GOLD());
  holder.position.set(0, 1.27, -0.02);
  group.add(holder);
  return group;
};

export const romanHelmet = () => {
  const root = new Group();
  const bronze = metal("#d39a45", 0.26), brass = GOLD();
  root.add(turn(ROMAN_BOWL, bronze), lining(ROMAN_BOWL));
  root.add(ring(0.975, 0.05, 0.4, brass, Math.PI * 1.1));
  root.add(band({ bottom: 1.1, height: 0.06, length: Math.PI * 0.8, material: brass, start: -Math.PI * 0.4,
    top: 0.97, y: 0.05 }));
  root.add(band({ bottom: 1.42, height: 0.3, length: Math.PI * 1.05, material: bronze, start: Math.PI * 0.475,
    top: 0.96, y: -0.12 }));
  root.add(ring(1.42, 0.03, -0.27, brass, Math.PI * 1.05, Math.PI));
  root.add(rivets({ count: 9, from: Math.PI * 0.6, material: brass, radius: 1.2, size: 0.04, to: Math.PI * 1.4,
    y: -0.17 }));
  for (const side of [-1, 1]) root.add(romanCheekGuard(side, bronze, brass));
  root.add(romanCrest());
  return root;
};

const KABUTO_BOWL: Profile = [[0.95, 0], [0.96, 0.2], [0.92, 0.48], [0.8, 0.76], [0.56, 0.98], [0.26, 1.08],
  [0.08, 1.1], [0, 1.1]];

/** Silk lacing (odoshi) over dark lacquer lames, with gilt edges. */
const lacingTexture = () => paintedTexture(512, 64, context => {
  context.fillStyle = "#151112";
  context.fillRect(0, 0, 512, 64);
  for (let x = 0; x < 512; x += 16) {
    const gradient = context.createLinearGradient(x, 0, x + 10, 0);
    gradient.addColorStop(0, "#1a2f6e");
    gradient.addColorStop(0.5, "#4f78d6");
    gradient.addColorStop(1, "#162659");
    context.fillStyle = gradient;
    context.fillRect(x + 3, 6, 10, 52);
  }
  context.fillStyle = "#d9a441";
  context.fillRect(0, 0, 512, 5);
  context.fillRect(0, 59, 512, 5);
}, 3);

/** Turned-back wing (fukigaeshi) with a gilt rim and a round crest. */
const fukigaeshi = (side: number, lacquered: Material, gold: Material) => {
  const outline = new Shape();
  outline.moveTo(0, 0);
  outline.lineTo(0.42, 0.08);
  outline.quadraticCurveTo(0.5, -0.18, 0.36, -0.42);
  outline.lineTo(0, -0.34);
  outline.lineTo(0, 0);
  const extrude = { bevelEnabled: true, bevelSegments: 2, bevelSize: 0.02, bevelThickness: 0.02, curveSegments: 16,
    depth: 0.04 };
  const group = new Group();
  group.add(new Mesh(new ExtrudeGeometry(outline, extrude), lacquered));
  const mon = new Mesh(new SphereGeometry(0.09, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  mon.rotation.x = Math.PI / 2;
  mon.scale.set(1, 0.35, 1);
  mon.position.set(0.24, -0.15, 0.07);
  group.add(mon);
  group.scale.set(side * 1.25, 1.25, 1.25);
  group.rotation.set(0, side * 0.75, side * -0.12);
  group.position.set(side * 0.8, 0.02, 0.8);
  return group;
};

/** Gilded maedate: two tall kuwagata blades in a V and a sun disc on the brow. */
const maedate = (gold: Material) => {
  const group = new Group();
  for (const side of [-1, 1]) {
    const blade = new Shape();
    blade.moveTo(0, 0);
    blade.quadraticCurveTo(0.34, 0.45, 0.52, 1.3);
    blade.quadraticCurveTo(0.66, 1.42, 0.72, 1.22);
    blade.quadraticCurveTo(0.56, 0.36, 0.2, -0.06);
    blade.lineTo(0, 0);
    const mesh = new Mesh(new ExtrudeGeometry(blade, { bevelEnabled: true, bevelSegments: 2, bevelSize: 0.015,
      bevelThickness: 0.015, curveSegments: 24, depth: 0.03 }), gold);
    mesh.scale.x = side;
    mesh.rotation.y = side * -0.25;
    mesh.position.set(side * 0.06, 0.18, 1.05);
    group.add(mesh);
  }
  const disc = new Mesh(new SphereGeometry(0.17, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal("#c9261f", 0.25, 0.4));
  disc.rotation.x = Math.PI / 2;
  disc.scale.set(1, 0.35, 1);
  disc.position.set(0, 0.32, 1.1);
  const rim = ring(0.17, 0.025, 0, gold);
  rim.rotation.set(0, 0, 0);
  rim.position.set(0, 0.32, 1.1);
  group.add(disc, rim);
  return group;
};

export const japaneseHelmet = () => {
  const root = new Group();
  const black = lacquer("#1b1517"), gold = GOLD(), iron = metal("#3d3a3c", 0.3);
  root.add(turn(KABUTO_BOWL, black), lining(KABUTO_BOWL));
  for (let index = 0; index < 32; index++) root.add(rib(KABUTO_BOWL, index * Math.PI / 16, iron, 0.018, 0.05, 0.93));
  root.add(ring(0.96, 0.035, 0.03, gold));
  const tehen = new Group();
  tehen.add(ring(0.13, 0.035, 1.1, gold), ring(0.08, 0.025, 1.14, gold));
  root.add(tehen);
  const visor = band({ bottom: 1.22, height: 0.16, length: Math.PI * 0.8, material: black, start: -Math.PI * 0.4,
    top: 0.97, y: 0.05 });
  root.add(visor, ring(1.21, 0.022, -0.03, gold, Math.PI * 0.8));
  const laced = new MeshPhysicalMaterial({ clearcoat: 0.8, clearcoatRoughness: 0.2, map: lacingTexture(),
    roughness: 0.5, side: DoubleSide });
  for (let lame = 0; lame < 4; lame++) {
    root.add(band({ bottom: 1.14 + lame * 0.16, height: 0.2, length: Math.PI * 1.5, material: laced,
      start: Math.PI * 0.25, top: 1 + lame * 0.16, y: -0.08 - lame * 0.17 }));
  }
  for (const side of [-1, 1]) root.add(fukigaeshi(side, lacquer("#7c1b16"), gold));
  root.add(maedate(gold));
  return root;
};

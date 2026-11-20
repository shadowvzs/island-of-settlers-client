import type * as Three from "three";

import { canvasTexture, seededRandom, type ThreeModule } from "./emblem-helpers";
import { createNubianSpear } from "./nubian-spear";
import { createSakuraBranch } from "./sakura-branch";

/**
 * One victory emblem per nation for the won-battle popups, built from original 3D geometry.
 * Loaded inside the render page by tools/bench/progression-icons.ts (served by Vite), so it
 * receives the page's Three.js module instead of importing it.
 */
export const VICTORY_NATIONS = ["roman", "viking", "japanese", "nubian"] as const;
export type VictoryNation = (typeof VICTORY_NATIONS)[number];

type Material = Three.Material;

const materials = (T: ThreeModule) => ({
  bronze: new T.MeshStandardMaterial({ color: "#b5722f", metalness: .7, roughness: .35 }),
  darkIron: new T.MeshStandardMaterial({ color: "#50545b", metalness: .85, roughness: .38 }),
  gold: new T.MeshStandardMaterial({ color: "#f2c35a", emissive: "#4a2f06", emissiveIntensity: .35,
    metalness: .8, roughness: .26 }),
  iron: new T.MeshStandardMaterial({ color: "#a7b0b8", metalness: .85, roughness: .3 }),
  leather: new T.MeshStandardMaterial({ color: "#5a2f1a", roughness: .75 }),
  red: new T.MeshStandardMaterial({ color: "#b71f22", roughness: .55, side: T.DoubleSide }),
  steel: new T.MeshStandardMaterial({ color: "#dfe6ec", metalness: .9, roughness: .16 }),
  wood: new T.MeshStandardMaterial({ color: "#6e4524", roughness: .65 })
});
type Materials = ReturnType<typeof materials>;

const extrude = (T: ThreeModule, shape: Three.Shape, depth: number, bevel: number, material: Material) =>
  new T.Mesh(new T.ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 3, bevelSize: bevel,
    bevelThickness: bevel, curveSegments: 24, depth }), material);

/** Round shield facing the camera: rim material on the edge, the face material on the front. */
const roundShield = (T: ThreeModule, radius: number, rim: Material, face: Material) => {
  const shield = new T.Mesh(new T.CylinderGeometry(radius, radius, .1, 72), [rim, face, rim]);
  shield.rotation.x = Math.PI / 2;
  return shield;
};

/** Two mirrored weapons: hilts low at the sides, blades crossing behind the centre piece. */
const crossedPair = (build: () => Three.Object3D, spread: number, low: number, tilt: number) => {
  const pair: Three.Object3D[] = [];
  for (const side of [-1, 1]) {
    const weapon = build();
    weapon.scale.x *= side;
    weapon.position.set(side * spread, low, -.2);
    weapon.rotation.z = side * tilt;
    pair.push(weapon);
  }
  return pair;
};

/** Places leaves (or needles, blossoms) along an arc on each side of the shield, bottom to top. */
const sideArcs = (
  T: ThreeModule, radius: number, count: number, stem: Material | null,
  place: (side: number, angle: number, index: number) => Three.Object3D
) => {
  const root = new T.Group();
  for (const side of [-1, 1]) {
    if (stem) {
      const arc = new T.Mesh(new T.TorusGeometry(radius, .016, 6, 48, Math.PI * .8), stem);
      arc.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI * .7; arc.position.z = .04; root.add(arc);
    }
    for (let index = 0; index < count; index++) root.add(place(side, -Math.PI / 2 + side * (.32 + index * .19), index));
  }
  return root;
};

const polarPosition = (object: Three.Object3D, angle: number, radius: number, z: number) => {
  object.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
  return object;
};

/** Roman gladius: leaf-shaped straight blade, oval guard, ribbed bone grip and a round pommel. */
const gladius = (T: ThreeModule, m: Materials) => () => {
  const sword = new T.Group();
  const blade = new T.Shape();
  blade.moveTo(-.075, 0); blade.lineTo(-.06, 1.0); blade.quadraticCurveTo(-.085, 1.3, -.06, 1.45);
  blade.lineTo(0, 1.82); blade.lineTo(.06, 1.45); blade.quadraticCurveTo(.085, 1.3, .06, 1.0);
  blade.lineTo(.075, 0); blade.closePath();
  const steel = extrude(T, blade, .012, .016, m.steel); steel.position.z = -.006; sword.add(steel);
  const ridge = new T.Mesh(new T.BoxGeometry(.012, 1.55, .03), m.iron); ridge.position.y = .85; sword.add(ridge);
  const guard = new T.Mesh(new T.SphereGeometry(.13, 24, 14), m.gold); guard.scale.set(1.15, .32, .6);
  sword.add(guard);
  const bone = new T.MeshStandardMaterial({ color: "#e8dcc0", roughness: .55 });
  const grip = new T.Mesh(new T.CylinderGeometry(.045, .05, .3, 18), bone); grip.position.y = -.17; sword.add(grip);
  for (let ridgeIndex = 0; ridgeIndex < 4; ridgeIndex++) {
    const ring = new T.Mesh(new T.TorusGeometry(.05, .012, 8, 18), bone);
    ring.rotation.x = Math.PI / 2; ring.position.y = -.29 + ridgeIndex * .08; sword.add(ring);
  }
  const pommel = new T.Mesh(new T.SphereGeometry(.09, 20, 14), m.gold); pommel.scale.y = .75;
  pommel.position.y = -.36; sword.add(pommel);
  sword.scale.set(1.5, 1.35, 1.4);
  return sword;
};

const SCUTUM_RADIUS = 1.1, SCUTUM_ARC = .84, SCUTUM_HEIGHT = 1.52;

/** Scutum face: red field, gold border, spread eagle wings and lightning bolts around the boss. */
const scutumFace = (T: ThreeModule) => canvasTexture(T, 1024, g => {
  g.fillStyle = "#a3161a"; g.fillRect(0, 0, 1024, 1024);
  g.globalAlpha = .1; g.fillStyle = "#000";
  for (let line = 0; line < 1024; line += 6) g.fillRect(0, line, 1024, 2);
  g.globalAlpha = 1;
  g.strokeStyle = "#f2c35a"; g.lineWidth = 22; g.strokeRect(44, 30, 936, 964);
  g.lineWidth = 8; g.strokeRect(84, 60, 856, 904);
  g.fillStyle = "#f2c35a"; g.translate(512, 512);
  // Feathered wings spreading from the boss to both sides.
  for (const side of [-1, 1]) for (let feather = 0; feather < 6; feather++) {
    g.save(); g.scale(side, 1); g.rotate(-.5 + feather * .17);
    g.beginPath(); g.moveTo(110, -20); g.quadraticCurveTo(330 - feather * 20, -60, 430 - feather * 28, 0);
    g.quadraticCurveTo(330 - feather * 20, 30, 110, 22); g.fill(); g.restore();
  }
  // Four zig-zag lightning bolts towards the corners.
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.save(); g.scale(x, y);
    g.beginPath(); g.moveTo(70, 150); g.lineTo(190, 250); g.lineTo(160, 270); g.lineTo(300, 400);
    g.lineTo(250, 400); g.lineTo(360, 450); g.lineTo(220, 420); g.lineTo(270, 410); g.lineTo(130, 300);
    g.lineTo(160, 285); g.lineTo(50, 175); g.closePath(); g.fill(); g.restore();
  }
  g.lineWidth = 12; g.strokeStyle = "#f2c35a"; g.beginPath(); g.arc(0, 0, 120, 0, Math.PI * 2); g.stroke();
});

/** Point on the curved scutum surface; along -1..1 across the arc, height in world units. */
const scutumPoint = (T: ThreeModule, across: number, height: number, lift: number) => {
  const angle = across * SCUTUM_ARC / 2, radius = SCUTUM_RADIUS + lift;
  return new T.Vector3(Math.sin(angle) * radius, height, Math.cos(angle) * radius - SCUTUM_RADIUS);
};

/** Legionary scutum: a curved red rectangle with gold edging, a bronze boss plate and gold umbo. */
const scutum = (T: ThreeModule, m: Materials) => {
  const root = new T.Group();
  const face = new T.MeshStandardMaterial({ map: scutumFace(T), roughness: .55, side: T.DoubleSide });
  const shell = new T.Mesh(new T.CylinderGeometry(SCUTUM_RADIUS, SCUTUM_RADIUS, SCUTUM_HEIGHT, 48, 1, true,
    -SCUTUM_ARC / 2, SCUTUM_ARC), face);
  shell.position.z = -SCUTUM_RADIUS; root.add(shell);
  const half = SCUTUM_HEIGHT / 2;
  const outline = [
    ...Array.from({ length: 25 }, (_, step) => scutumPoint(T, step / 12 - 1, half, .01)),
    ...Array.from({ length: 25 }, (_, step) => scutumPoint(T, 1 - step / 12, -half, .01))
  ];
  root.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(outline, true, "catmullrom", .02), 400, .035, 10,
    true), m.gold));
  const plate = new T.Mesh(new T.CylinderGeometry(SCUTUM_RADIUS + .02, SCUTUM_RADIUS + .02, .36, 16, 1, true,
    -.14, .28), m.bronze);
  plate.position.z = -SCUTUM_RADIUS; root.add(plate);
  const boss = new T.Mesh(new T.SphereGeometry(.15, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), m.gold);
  boss.rotation.x = Math.PI / 2; boss.position.z = .02; root.add(boss);
  for (const [x, y] of [[-.12, .14], [.12, .14], [-.12, -.14], [.12, -.14]] as const) {
    const rivet = new T.Mesh(new T.SphereGeometry(.022, 10, 8), m.gold);
    rivet.position.copy(scutumPoint(T, x / (SCUTUM_RADIUS * SCUTUM_ARC / 2), y, .03)); root.add(rivet);
  }
  return root;
};

const romanEmblem = (T: ThreeModule, m: Materials) => {
  const root = new T.Group();
  root.add(...crossedPair(gladius(T, m), .88, -1.05, .55));
  root.add(scutum(T, m));
  root.add(sideArcs(T, .82, 13, m.gold, (side, angle) => {
    const pair = new T.Group();
    for (const ring of [-1, 1]) {
      const leaf = new T.Mesh(new T.SphereGeometry(.07, 14, 10), m.gold); leaf.scale.set(1, .38, .28);
      polarPosition(leaf, angle, .82 + ring * .07, .05);
      leaf.rotation.z = angle + side * (Math.PI / 2 - ring * .55); pair.add(leaf);
    }
    return pair;
  }));
  const knot = new T.Mesh(new T.TorusGeometry(.07, .03, 10, 20), m.red); knot.position.set(0, -.9, .08); root.add(knot);
  for (const side of [-1, 1]) {
    const tail = new T.Mesh(new T.PlaneGeometry(.14, .42, 1, 6), m.red);
    tail.position.set(side * .12, -1.08, .06); tail.rotation.z = side * .35; root.add(tail);
  }
  return root;
};

/** Viking bearded axe: ash haft with iron bands and a leather wrap, a long-bearded head. */
const beardedAxe = (T: ThreeModule, m: Materials) => () => {
  const axe = new T.Group();
  const haft = new T.Mesh(new T.CylinderGeometry(.04, .05, 2.9, 18), m.wood); haft.position.y = 1.15; axe.add(haft);
  const wrap = new T.Mesh(new T.CylinderGeometry(.055, .058, .34, 18), m.leather); wrap.position.y = -.1;
  axe.add(wrap);
  for (const y of [.1, -.3]) {
    const band = new T.Mesh(new T.TorusGeometry(.055, .012, 8, 18), m.darkIron);
    band.rotation.x = Math.PI / 2; band.position.y = y; axe.add(band);
  }
  const head = new T.Shape();
  head.moveTo(.06, .16); head.lineTo(-.14, .18); head.quadraticCurveTo(-.3, .22, -.44, .36);
  head.quadraticCurveTo(-.56, .02, -.46, -.36); head.quadraticCurveTo(-.3, -.26, -.18, -.06);
  head.quadraticCurveTo(-.1, .02, .06, -.04); head.closePath();
  const iron = extrude(T, head, .03, .02, m.darkIron); iron.position.set(0, 2.35, -.015); axe.add(iron);
  const edge = new T.Shape();
  edge.moveTo(-.44, .36); edge.quadraticCurveTo(-.56, .02, -.46, -.36); edge.lineTo(-.4, -.3);
  edge.quadraticCurveTo(-.49, .02, -.39, .3); edge.closePath();
  const bright = extrude(T, edge, .034, .02, m.steel); bright.position.set(0, 2.35, -.017); axe.add(bright);
  const eye = new T.Mesh(new T.CylinderGeometry(.07, .07, .24, 16), m.darkIron); eye.position.y = 2.41; axe.add(eye);
  axe.scale.set(1.25, 1.05, 1.25);
  return axe;
};

const vikingShieldFace = (T: ThreeModule) => canvasTexture(T, 512, g => {
  g.translate(256, 256);
  for (let quarter = 0; quarter < 8; quarter++) {
    g.fillStyle = quarter % 2 ? "#e2cc98" : "#8f2119";
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 256, quarter * Math.PI / 4, (quarter + 1) * Math.PI / 4); g.fill();
  }
  g.globalAlpha = .18; g.fillStyle = "#2b1a0e";
  for (let plank = -256; plank < 256; plank += 46) g.fillRect(plank, -256, 3, 512);
  g.globalAlpha = 1;
  // Knotwork band: two interlaced wavy rings in a dark outline with an ochre core.
  for (const [width, colour] of [[16, "#1d140c"], [7, "#e0a83c"]] as const) {
    g.lineWidth = width; g.strokeStyle = colour;
    for (const phase of [0, Math.PI]) {
      g.beginPath();
      for (let step = 0; step <= 240; step++) {
        const angle = step / 240 * Math.PI * 2;
        const radius = 172 + Math.sin(angle * 9 + phase) * 20;
        g.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      g.stroke();
    }
  }
  // A black raven with spread wings in the upper field, above the boss.
  g.fillStyle = "#17110c"; g.translate(0, -100); g.scale(1.5, 1.5);
  g.beginPath(); g.moveTo(-74, -6); g.quadraticCurveTo(-40, -40, -10, -8); g.lineTo(-6, -18);
  g.quadraticCurveTo(0, -30, 8, -20); g.lineTo(22, -22); g.lineTo(10, -12); g.lineTo(12, -6);
  g.quadraticCurveTo(40, -40, 74, -6); g.quadraticCurveTo(40, -10, 14, 8); g.lineTo(18, 30);
  g.lineTo(0, 22); g.lineTo(-18, 30); g.lineTo(-14, 8); g.quadraticCurveTo(-40, -10, -74, -6); g.fill();
});

const pineSprig = (T: ThreeModule, needle: Material, angle: number) => {
  const sprig = new T.Group();
  for (let index = 0; index < 7; index++) {
    const cone = new T.Mesh(new T.ConeGeometry(.018, .2, 5), needle);
    cone.position.y = .08; const holder = new T.Group(); holder.add(cone);
    holder.rotation.z = angle - Math.PI / 2 + (index - 3) * .32; sprig.add(holder);
  }
  return sprig;
};

const braidedCord = (T: ThreeModule, colours: readonly Material[]) => {
  const root = new T.Group();
  const points = [new T.Vector3(-.62, -.62, .1), new T.Vector3(-.3, -.98, .14), new T.Vector3(0, -1.06, .16),
    new T.Vector3(.3, -.98, .14), new T.Vector3(.62, -.62, .1)];
  const path = new T.CatmullRomCurve3(points);
  colours.forEach((colour, strand) => {
    const twisted = Array.from({ length: 81 }, (_, step) => {
      const at = path.getPoint(step / 80), twist = step / 80 * Math.PI * 18 + strand * Math.PI;
      return at.add(new T.Vector3(0, Math.cos(twist) * .025, Math.sin(twist) * .025));
    });
    root.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(twisted), 240, .022, 8), colour));
  });
  for (const side of [-1, 1]) {
    const tassel = new T.Mesh(new T.ConeGeometry(.05, .2, 14), colours[0]!);
    tassel.position.set(side * .66, -.8, .1); root.add(tassel);
  }
  return root;
};

const vikingEmblem = (T: ThreeModule, m: Materials) => {
  const root = new T.Group();
  root.add(...crossedPair(beardedAxe(T, m), .95, -1.02, .75));
  const face = new T.MeshStandardMaterial({ map: vikingShieldFace(T), roughness: .75 });
  const shield = roundShield(T, .64, m.leather, face); shield.rotation.y = Math.PI / 2; root.add(shield);
  const rim = new T.Mesh(new T.TorusGeometry(.64, .045, 12, 72), m.leather); rim.position.z = .03; root.add(rim);
  for (let rivet = 0; rivet < 20; rivet++) {
    const stud = new T.Mesh(new T.SphereGeometry(.026, 10, 8), m.darkIron);
    root.add(polarPosition(stud, rivet / 20 * Math.PI * 2, .6, .07));
  }
  const flange = new T.Mesh(new T.CylinderGeometry(.2, .2, .03, 40), m.darkIron);
  flange.rotation.x = Math.PI / 2; flange.position.z = .06; root.add(flange);
  const boss = new T.Mesh(new T.SphereGeometry(.15, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), m.darkIron);
  boss.rotation.x = Math.PI / 2; boss.position.z = .07; root.add(boss);
  const needle = new T.MeshStandardMaterial({ color: "#2f5c34", roughness: .7 });
  root.add(sideArcs(T, .82, 12, m.wood, (_side, angle) => polarPosition(pineSprig(T, needle, angle), angle, .82, .06)));
  for (const side of [-1, 1]) {
    const cone = new T.Mesh(new T.SphereGeometry(.06, 12, 10), m.wood); cone.scale.set(.8, 1.3, .8);
    cone.position.set(side * .5, -.68, .12); root.add(cone);
  }
  root.add(braidedCord(T, [m.red, m.gold]));
  return root;
};

/** Tsuka-ito: black silk wrap crossing over white rayskin, leaving rows of white diamonds. */
const tsukaWrap = (T: ThreeModule) => canvasTexture(T, 256, g => {
  g.fillStyle = "#121318"; g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#efe9da";
  for (let row = 0; row < 8; row++) for (let column = 0; column < 4; column++) {
    const x = column * 64 + 32, y = row * 32 + 16;
    g.beginPath(); g.moveTo(x, y - 11); g.lineTo(x + 22, y); g.lineTo(x, y + 11); g.lineTo(x - 22, y); g.fill();
  }
  g.strokeStyle = "#2a2c35"; g.lineWidth = 3;
  for (let row = 0; row <= 8; row++) {
    g.beginPath(); g.moveTo(0, row * 32); g.lineTo(256, row * 32); g.stroke();
  }
});

const KATANA_LENGTH = 2.35, KATANA_SORI = .3, KATANA_TIP = .92;

/** Blade centre line, curving towards the spine (+x) along the whole length. */
const katanaCentre = (T: ThreeModule, along: number) =>
  new T.Vector2(KATANA_SORI * along * along, KATANA_LENGTH * along);

/** Point across the blade at `along`: +1 on the spine, -1 on the edge. */
const katanaPoint = (T: ThreeModule, along: number, across: number) => {
  const centre = katanaCentre(T, along);
  const tangent = new T.Vector2(2 * KATANA_SORI * along, KATANA_LENGTH).normalize();
  const width = .085 - .02 * along;
  return centre.add(new T.Vector2(tangent.y, -tangent.x).multiplyScalar(across * width / 2));
};

/** Single-edged blade outline with the angled kissaki point. */
const katanaBlade = (T: ThreeModule) => {
  const points: Three.Vector2[] = [];
  for (let step = 0; step <= 40; step++) points.push(katanaPoint(T, step / 40 * KATANA_TIP, 1));
  points.push(katanaPoint(T, 1, .7));
  for (let step = 40; step >= 0; step--) points.push(katanaPoint(T, step / 40 * KATANA_TIP, -1));
  return new T.Shape(points);
};

/** Frosted temper line (hamon) along the edge with a gently waving notare border. */
const katanaHamon = (T: ThreeModule) => {
  const points: Three.Vector2[] = [];
  for (let step = 0; step <= 60; step++) {
    const along = .03 + step / 60 * (KATANA_TIP - .03);
    points.push(katanaPoint(T, along, -.35 + Math.sin(along * 42) * .14));
  }
  points.push(katanaPoint(T, .985, .3));
  for (let step = 60; step >= 0; step--) points.push(katanaPoint(T, .03 + step / 60 * (KATANA_TIP - .03), -.92));
  return new T.Shape(points);
};

/** Mokko tsuba: a four-lobed iron guard with a gold rim line. */
const katanaTsuba = (T: ThreeModule, m: Materials) => {
  const outline = Array.from({ length: 97 }, (_, step) => {
    const angle = step / 96 * Math.PI * 2, radius = .13 + .022 * Math.cos(angle * 4);
    return new T.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  const tsuba = extrude(T, new T.Shape(outline), .02, .008, m.darkIron);
  tsuba.rotation.x = Math.PI / 2; tsuba.position.y = .01;
  const rim = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(outline.map(point =>
    new T.Vector3(point.x * .86, 0, -point.y * .86)), true), 96, .006, 6, true), m.gold);
  rim.position.y = .012;
  const guard = new T.Group(); guard.add(tsuba, rim);
  return guard;
};

/** Katana: curved blade with hamon, gold habaki, mokko tsuba, long diamond-wrapped tsuka and kashira. */
const katana = (T: ThreeModule, m: Materials, wrap: Material) => () => {
  const sword = new T.Group();
  const blade = extrude(T, katanaBlade(T), .008, .01, new T.MeshStandardMaterial({ color: "#c3ccd6",
    metalness: .95, roughness: .14 }));
  blade.position.set(-.02, .05, -.004); sword.add(blade);
  const frost = new T.MeshStandardMaterial({ color: "#f4f7fa", metalness: .45, roughness: .42 });
  const hamon = new T.Mesh(new T.ShapeGeometry(katanaHamon(T), 2), frost);
  hamon.position.set(-.02, .05, .0155); sword.add(hamon);
  const habaki = new T.Mesh(new T.BoxGeometry(.1, .09, .05), m.gold); habaki.position.y = .07; sword.add(habaki);
  sword.add(katanaTsuba(T, m));
  for (const y of [.035, -.015]) {
    const seppa = new T.Mesh(new T.CylinderGeometry(.06, .06, .012, 20), m.gold);
    seppa.position.y = y; sword.add(seppa);
  }
  const fuchi = new T.Mesh(new T.CylinderGeometry(.05, .05, .05, 20), m.gold); fuchi.position.y = -.045;
  sword.add(fuchi);
  const tsuka = new T.Mesh(new T.CylinderGeometry(.044, .048, .6, 20), wrap); tsuka.scale.z = .8;
  tsuka.position.y = -.37; sword.add(tsuka);
  const kashira = new T.Mesh(new T.SphereGeometry(.05, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.darkIron);
  kashira.rotation.x = Math.PI; kashira.scale.set(1, .7, .8); kashira.position.y = -.67; sword.add(kashira);
  const cap = new T.Mesh(new T.TorusGeometry(.048, .008, 8, 20), m.gold); cap.rotation.x = Math.PI / 2;
  cap.position.y = -.67; sword.add(cap);
  sword.scale.setScalar(1.25);
  return sword;
};

const silkCord = (T: ThreeModule, m: Materials) => {
  const root = new T.Group();
  for (const side of [-1, 1]) {
    const loop = new T.Mesh(new T.TorusGeometry(.09, .022, 10, 28), m.red);
    loop.scale.set(1.3, .7, 1); loop.position.set(side * .12, -.82, .14); loop.rotation.z = side * .4; root.add(loop);
    const cord = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(side * .03, -.85, .14),
      new T.Vector3(side * .1, -1.02, .14), new T.Vector3(side * .14, -1.16, .12)]), 16, .016, 8), m.red);
    root.add(cord);
    const tassel = new T.Mesh(new T.ConeGeometry(.045, .2, 14), m.red); tassel.position.set(side * .15, -1.24, .12);
    root.add(tassel);
    const cap = new T.Mesh(new T.SphereGeometry(.03, 12, 10), m.gold); cap.position.set(side * .145, -1.15, .12);
    root.add(cap);
  }
  const knot = new T.Mesh(new T.SphereGeometry(.045, 14, 12), m.red); knot.position.set(0, -.84, .15); root.add(knot);
  return root;
};

/** Flat-cut disc ring (maru) from inner to outer radius. */
const flatRing = (T: ThreeModule, inner: number, outer: number, material: Material) => {
  const shape = new T.Shape(); shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new T.Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true); shape.holes.push(hole);
  return extrude(T, shape, .01, .005, material);
};

/**
 * Original kamon: a maru ring around five separate notched sakura petals, a hollow centre and a
 * ring of five stamen dots, all flat-cut like a family crest.
 */
const sakuraKamon = (T: ThreeModule, radius: number, material: Material) => {
  const crest = new T.Group();
  crest.add(flatRing(T, radius * .88, radius, material));
  const petalLength = radius * .74;
  for (let index = 0; index < 5; index++) {
    const petal = new T.Shape();
    const base = petalLength * .2, width = petalLength * .4;
    petal.moveTo(0, base);
    petal.bezierCurveTo(-width * 1.1, base + petalLength * .2, -width, petalLength, -width * .28, petalLength);
    petal.lineTo(0, petalLength * .84); petal.lineTo(width * .28, petalLength);
    petal.bezierCurveTo(width, petalLength, width * 1.1, base + petalLength * .2, 0, base);
    const mesh = extrude(T, petal, .01, .005, material); mesh.rotation.z = index / 5 * Math.PI * 2; crest.add(mesh);
    const stamen = new T.Mesh(new T.CylinderGeometry(radius * .035, radius * .035, .02, 12), material);
    stamen.rotation.x = Math.PI / 2;
    crest.add(polarPosition(stamen, Math.PI / 2 + (index + .5) / 5 * Math.PI * 2, petalLength * .17, .01));
  }
  return crest;
};

/** Round black-lacquered shield: crimson outer band, gold rims and a gold sakura kamon in the centre. */
const lacqueredShield = (T: ThreeModule, m: Materials) => {
  const shield = new T.Group();
  const lacquer = new T.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: .06, color: "#141012",
    roughness: .3 });
  const crimson = new T.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: .08, color: "#a8121a",
    roughness: .3 });
  shield.add(roundShield(T, .62, lacquer, lacquer));
  const band = flatRing(T, .5, .62, crimson); band.position.z = .045; shield.add(band);
  for (const [radius, tube] of [[.62, .04], [.5, .014]] as const) {
    const ring = new T.Mesh(new T.TorusGeometry(radius, tube, 12, 72), m.gold); ring.position.z = .06; shield.add(ring);
  }
  for (let stud = 0; stud < 12; stud++) {
    const rivet = new T.Mesh(new T.SphereGeometry(.022, 10, 8), m.gold);
    shield.add(polarPosition(rivet, stud / 12 * Math.PI * 2, .56, .065));
  }
  const crest = sakuraKamon(T, .4, m.gold); crest.position.z = .05; shield.add(crest);
  return shield;
};

const japaneseEmblem = (T: ThreeModule, m: Materials) => {
  const root = new T.Group();
  // The blades cross in a wide X behind the shield, hilts in the bottom corners.
  const wrap = new T.MeshStandardMaterial({ map: tsukaWrap(T), roughness: .7 });
  root.add(...crossedPair(katana(T, m, wrap), .82, -.83, .78));
  root.add(lacqueredShield(T, m));
  for (const side of [-1, 1]) root.add(createSakuraBranch(T, side));
  root.add(silkCord(T, m));
  return root;
};

const HIDE_OCHRE = "#c0702a", HIDE_BLACK = "#1b130d", HIDE_CREAM = "#f1e6cc";

/** Faint cowhide patches and hair under the paint, so the face still reads as hide. */
const paintHide = (g: CanvasRenderingContext2D) => {
  g.fillStyle = "#dcc7a0"; g.fillRect(-256, -256, 512, 512);
  const random = seededRandom(17);
  g.globalAlpha = .35;
  for (let patch = 0; patch < 9; patch++) {
    const x = random() * 512 - 256, y = random() * 512 - 256, size = 40 + random() * 60;
    g.fillStyle = "#6a4022"; g.beginPath();
    for (let step = 0; step < 14; step++) {
      const angle = step / 14 * Math.PI * 2, radius = size * (.65 + random() * .5);
      g.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    g.fill();
  }
  g.globalAlpha = .12; g.fillStyle = "#000";
  for (let hair = 0; hair < 900; hair++) g.fillRect(random() * 512 - 256, random() * 512 - 256, 1, 5);
  g.globalAlpha = 1;
};

/** Sawtooth border of alternating black and ochre triangles pointing inwards. */
const paintSawtoothBorder = (g: CanvasRenderingContext2D) => {
  for (let tooth = 0; tooth < 36; tooth++) {
    const start = tooth / 36 * Math.PI * 2, end = (tooth + 1) / 36 * Math.PI * 2, middle = (start + end) / 2;
    g.fillStyle = tooth % 2 ? HIDE_OCHRE : HIDE_BLACK;
    g.beginPath(); g.moveTo(Math.cos(start) * 250, Math.sin(start) * 250);
    g.lineTo(Math.cos(middle) * 206, Math.sin(middle) * 206); g.lineTo(Math.cos(end) * 250, Math.sin(end) * 250);
    g.fill();
  }
};

/** Stacked chevron bands either side of the spine: ochre in a black outline on cream. */
const paintChevrons = (g: CanvasRenderingContext2D) => {
  g.save(); g.beginPath(); g.arc(0, 0, 200, 0, Math.PI * 2); g.clip();
  for (let band = -4; band <= 4; band++) {
    const y = band * 52;
    for (const [width, colour] of [[30, HIDE_BLACK], [18, band % 2 ? HIDE_CREAM : HIDE_OCHRE]] as const) {
      g.lineWidth = width; g.strokeStyle = colour; g.lineJoin = "miter"; g.beginPath();
      for (let step = -6; step <= 6; step++) g.lineTo(step * 40, y + (step % 2 ? 22 : -22));
      g.stroke();
    }
  }
  g.fillStyle = HIDE_BLACK; g.fillRect(-26, -256, 52, 512);
  g.restore();
};

/** Painted hide face: chevron bands, a black centre stripe under the spine and a sawtooth border. */
const nubianShieldFace = (T: ThreeModule) => canvasTexture(T, 512, g => {
  g.translate(256, 256);
  paintHide(g);
  paintChevrons(g);
  paintSawtoothBorder(g);
});

const palmFrond = (T: ThreeModule, leaf: Material, side: number, lean: number) => {
  const frond = new T.Group();
  const points = [new T.Vector3(0, 0, 0), new T.Vector3(side * .16, .45, 0), new T.Vector3(side * .42, .78, 0),
    new T.Vector3(side * .7, .9, 0)];
  const curve = new T.CatmullRomCurve3(points);
  frond.add(new T.Mesh(new T.TubeGeometry(curve, 24, .014, 6), leaf));
  for (let index = 2; index < 22; index++) {
    const at = index / 22, point = curve.getPoint(at), tangent = curve.getTangent(at);
    const angle = Math.atan2(tangent.y, tangent.x);
    for (const flank of [-1, 1]) {
      const length = .2 * Math.sin(at * Math.PI) + .05;
      const leaflet = new T.Mesh(new T.SphereGeometry(.5, 10, 6), leaf);
      leaflet.scale.set(length, .028, .012);
      const tilt = angle + flank * 1.1 * side;
      leaflet.position.set(point.x + Math.cos(tilt) * length * .5, point.y + Math.sin(tilt) * length * .5, 0);
      leaflet.rotation.z = tilt; frond.add(leaflet);
    }
  }
  frond.rotation.z = lean;
  return frond;
};

const beadStrand = (T: ThreeModule, m: Materials, turquoise: Material, sag: number, width: number) => {
  const strand = new T.Group();
  for (let index = 0; index <= 18; index++) {
    const at = index / 18 * 2 - 1;
    const bead = new T.Mesh(new T.SphereGeometry(index % 2 ? .028 : .036, 12, 10), index % 2 ? m.gold : turquoise);
    bead.position.set(at * width, -sag * (1 - at * at), 0); strand.add(bead);
  }
  return strand;
};

const HIDE_STRETCH = 1.6;

/**
 * Tall oval hide shield: painted face, rawhide rim, a wooden spine running past both ends and
 * rawhide lacing crossing the spine down the centre.
 */
const hideShield = (T: ThreeModule, m: Materials) => {
  const root = new T.Group();
  const hide = new T.MeshStandardMaterial({ map: nubianShieldFace(T), roughness: .8 });
  const face = roundShield(T, .5, m.leather, hide);
  face.rotation.y = Math.PI / 2; face.scale.x = HIDE_STRETCH; root.add(face);
  const rim = new T.Mesh(new T.TorusGeometry(.5, .03, 12, 96), m.leather);
  rim.scale.y = HIDE_STRETCH; rim.position.z = .04; root.add(rim);
  const rawhide = new T.MeshStandardMaterial({ color: "#ead9b4", roughness: .7 });
  for (let stitch = 0; stitch < 40; stitch++) {
    const angle = stitch / 40 * Math.PI * 2;
    const knot = new T.Mesh(new T.BoxGeometry(.05, .016, .02), rawhide);
    knot.position.set(Math.cos(angle) * .5, Math.sin(angle) * .5 * HIDE_STRETCH, .07);
    knot.rotation.z = angle; root.add(knot);
  }
  const spine = new T.Mesh(new T.CylinderGeometry(.03, .034, 2.0, 16), m.wood); spine.position.z = .09;
  root.add(spine);
  for (const end of [-1, 1]) {
    const tip = new T.Mesh(new T.SphereGeometry(.045, 14, 10), m.gold); tip.position.set(0, end * 1.0, .09);
    root.add(tip);
  }
  for (let lace = 0; lace < 13; lace++) {
    const y = -.66 + lace * .11;
    for (const tilt of [-.5, .5]) {
      const strip = new T.Mesh(new T.BoxGeometry(.15, .018, .014), rawhide);
      strip.position.set(0, y, .125); strip.rotation.z = tilt; root.add(strip);
    }
  }
  return root;
};

const nubianEmblem = (T: ThreeModule, m: Materials) => {
  const root = new T.Group();
  root.add(...crossedPair(() => createNubianSpear(T), .8, -1.08, .6));
  const leaf = new T.MeshStandardMaterial({ color: "#4f8a2c", roughness: .6, side: T.DoubleSide });
  for (const side of [-1, 1]) {
    for (const [lean, lift] of [[.25, 0], [-.15, .1]] as const) {
      const frond = palmFrond(T, leaf, side, side * lean); frond.position.set(side * .18, -.82 + lift, -.1);
      root.add(frond);
    }
  }
  root.add(hideShield(T, m));
  const turquoise = new T.MeshPhysicalMaterial({ clearcoat: .8, color: "#2fb5a8", roughness: .25 });
  for (const [sag, width, y] of [[.12, .3, -.98], [.18, .4, -1.02]] as const) {
    const strand = beadStrand(T, m, turquoise, sag, width); strand.position.set(0, y, .14); root.add(strand);
  }
  const drop = new T.Mesh(new T.ConeGeometry(.05, .14, 16), m.gold); drop.rotation.z = Math.PI;
  drop.position.set(0, -1.28, .14); root.add(drop);
  return root;
};

const EMBLEMS: Record<VictoryNation, (T: ThreeModule, m: Materials) => Three.Group> = {
  japanese: japaneseEmblem, nubian: nubianEmblem, roman: romanEmblem, viking: vikingEmblem
};

/** The nation's emblem, tilted slightly so the 3D relief catches the key light. */
export const buildVictoryEmblem = (T: ThreeModule, nation: VictoryNation) => {
  const root = EMBLEMS[nation](T, materials(T));
  root.rotation.set(-.12, .18, 0);
  return root;
};

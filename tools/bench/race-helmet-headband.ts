import {
  BoxGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Group, type Material, Mesh, MeshPhysicalMaterial,
  OctahedronGeometry, PlaneGeometry, RepeatWrapping, SphereGeometry, Vector3
} from "three";

import { GOLD } from "./race-helmet-models";
import {
  band, bend, lacquer, paintedTexture, type Profile, ring, seeded, turn
} from "./race-helmet-parts";

/**
 * Nubian race icon (owner choice 2026-10-12): a gold diadem inlaid with turquoise and carnelian, crowned by
 * upright ostrich feathers, worn over close-cropped hair. Same axes and rim height as the helmets.
 */

const BAND_RADIUS = 1.0;
const BAND_HEIGHT = 0.42;
const INLAY_COUNT = 26;

/** Rectangular stones set edge to edge around the band, alternating turquoise and carnelian. */
const addInlays = (root: Group, carnelian: Material, turquoise: Material) => {
  const stone = new BoxGeometry(0.16, 0.2, 0.05);
  for (let index = 0; index < INLAY_COUNT; index++) {
    const angle = (index / INLAY_COUNT) * Math.PI * 2;
    const inlay = new Mesh(stone, index % 2 ? turquoise : carnelian);
    inlay.position.set(Math.sin(angle) * 1.025, BAND_HEIGHT / 2, Math.cos(angle) * 1.025);
    inlay.rotation.y = angle;
    root.add(inlay);
  }
};

/** Raised lotus plaque at the brow: gold petals around a large carnelian cabochon. */
const addBrowPlaque = (root: Group, gold: Material, carnelian: Material,
  turquoise: Material) => {
  const plaque = new Group();
  plaque.position.set(0, 0.34, 1.04);
  root.add(plaque);
  for (let petal = 0; petal < 5; petal++) {
    const angle = (petal - 2) * 0.42;
    const leaf = new Mesh(new SphereGeometry(0.11, 20, 12), gold);
    leaf.scale.set(0.55, 1.5, 0.35);
    leaf.position.set(Math.sin(angle) * 0.17, Math.cos(angle) * 0.17, 0);
    leaf.rotation.z = -angle;
    plaque.add(leaf);
  }
  const cabochon = new Mesh(new SphereGeometry(0.12, 28, 16), carnelian);
  cabochon.scale.z = 0.6;
  cabochon.position.z = 0.05;
  const setting = ring(0.13, 0.03, 0, gold);
  setting.rotation.set(0, 0, 0);
  setting.position.z = 0.04;
  plaque.add(cabochon, setting);
  for (const side of [-1, 1]) {
    const drop = new Mesh(new OctahedronGeometry(0.06, 0), turquoise);
    drop.scale.set(0.8, 1.4, 0.5);
    drop.position.set(side * 0.2, -0.14, 0.02);
    plaque.add(drop);
  }
};

/**
 * Broad ostrich plume: barbs widen to a full rounded head; the upper third takes `tip` colour so the
 * dark-tipped plume reads at icon size.
 */
const ostrichTexture = (tip: string) => paintedTexture(128, 512, context => {
  const random = seeded(17);
  context.globalAlpha = 0.9;
  context.lineWidth = 2.2;
  for (let y = 504; y > 6; y -= 2) {
    const rise = (512 - y) / 506;
    const half = 60 * Math.min(1, Math.sin(Math.PI * Math.min(1, rise * 0.62)) * 1.25) * (rise > 0.9 ? 1 - (rise
      - 0.9) * 5 : 1) + 4;
    context.strokeStyle = rise > 0.64 ? tip : "#fbf7ee";
    for (const side of [-1, 1]) {
      const reach = half * (0.78 + random() * 0.24);
      context.beginPath();
      context.moveTo(64, y);
      context.quadraticCurveTo(64 + side * reach * 0.6, y - 8, 64 + side * reach, y + 8 + random() * 10);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  context.strokeStyle = "#d8cdb6";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(64, 512);
  context.lineTo(64, 16);
  context.stroke();
});

/** One upright plume, its head nodding slightly forward. */
const ostrichPlume = (tip: string) => {
  const geometry = bend(new PlaneGeometry(0.86, 1.7, 12, 24), vertex => {
    const rise = (vertex.y + 0.85) / 1.7;
    return new Vector3(vertex.x, vertex.y, rise * rise * 0.3 - Math.abs(vertex.x) * 0.3);
  });
  const material = new MeshPhysicalMaterial({ alphaTest: 0.25, map: ostrichTexture(tip), roughness: 0.9,
    sheen: 0.6, sheenColor: "#ffffff", side: DoubleSide });
  return new Mesh(geometry, material);
};

/** Gold socket at the back of the head holding three plumes in a fan; the dark-tipped one leads. */
const addPlumes = (root: Group, gold: Material) => {
  const socket = new Mesh(new CylinderGeometry(0.13, 0.1, 0.4, 20), gold);
  socket.position.set(0, 0.92, -0.52);
  socket.rotation.x = -0.35;
  root.add(socket);
  for (const [tip, lean, depth] of [
    ["#fbf7ee", -1, -0.62],
    ["#fbf7ee", 1, -0.62],
    ["#231d19", 0, -0.5]
  ] as const) {
    const feather = ostrichPlume(tip);
    feather.scale.setScalar(1.15);
    feather.position.set(lean * 0.42, 1.5 - Math.abs(lean) * 0.14, depth);
    feather.rotation.set(0.1, 0.3, -lean * 0.6);
    root.add(feather);
  }
};

/** Tile size and repeats of the hair texture: square texels on the lathe (about 6.2 around, 1.5 up). */
const HAIR_TILE = 256;
const HAIR_REPEAT = { around: 10, up: 2.5 };

/**
 * Close-cropped coils seen from above: each coil a tight dark ring with a lit crest. `relief` paints the
 * bump (bright crests on a dark scalp); otherwise the colour, a warm black-brown with fine highlights.
 */
const coilTexture = (relief: boolean) => {
  const texture = paintedTexture(HAIR_TILE, HAIR_TILE, context => {
    context.fillStyle = relief ? "#202020" : "#0e0907";
    context.fillRect(0, 0, HAIR_TILE, HAIR_TILE);
    const random = seeded(5);
    for (let coil = 0; coil < 2600; coil++) {
      const x = random() * HAIR_TILE, y = random() * HAIR_TILE, size = 1.3 + random() * 1.3;
      const lit = random();
      context.strokeStyle = coilShade(relief, lit);
      context.lineWidth = 1.4;
      context.beginPath();
      context.arc(x, y, size, random() * 6, random() * 6 + 4.2);
      context.stroke();
    }
  }, HAIR_REPEAT.around);
  texture.wrapT = RepeatWrapping;
  texture.repeat.y = HAIR_REPEAT.up;
  return texture;
};

const coilShade = (relief: boolean, lit: number) => {
  if (relief) return lit > 0.5 ? "#f0f0f0" : "#a0a0a0";
  if (lit > 0.85) return "#43312a";
  return lit > 0.45 ? "#241913" : "#170f0a";
};

/** A head shape (crown higher than the band) rather than a flat cap, so the hair reads as a scalp. */
const HAIR: Profile = [[0.97, 0], [0.99, 0.28], [0.94, 0.56], [0.82, 0.8], [0.62, 0.98], [0.36, 1.09],
  [0.12, 1.13], [0, 1.14]];

/**
 * Matte coils with a warm sheen at grazing angles: the hair keeps a soft lit edge, so the dome holds its
 * shape against the dark theme instead of melting into the background.
 */
const hairMaterial = () => new MeshPhysicalMaterial({ bumpMap: coilTexture(true), bumpScale: 1.6,
  map: coilTexture(false), roughness: 0.62, sheen: 0.8, sheenColor: "#9c7a60", sheenRoughness: 0.5 });

/** Warm back light that only this render carries: a thin rim around the hair against a dark page. */
const hairRimLight = () => {
  const light = new DirectionalLight("#ffd6aa", 1.6);
  light.position.set(-4, 0.6, -2.5);
  return light;
};

export const nubianHeadband = () => {
  const root = new Group();
  const gold = GOLD();
  const carnelian = lacquer("#c2411c"), turquoise = lacquer("#1d9c95");
  root.add(turn(HAIR, hairMaterial()), hairRimLight());
  root.add(band({ bottom: BAND_RADIUS + 0.02, height: BAND_HEIGHT, material: gold, top: BAND_RADIUS,
    y: BAND_HEIGHT / 2 }));
  root.add(ring(BAND_RADIUS + 0.03, 0.035, 0.01, gold), ring(BAND_RADIUS + 0.01, 0.035, BAND_HEIGHT, gold));
  addInlays(root, carnelian, turquoise);
  addBrowPlaque(root, gold, carnelian, turquoise);
  addPlumes(root, gold);
  return root;
};

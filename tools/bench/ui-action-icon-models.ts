import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3
} from "three";

import { createToolIconModel } from "../../src/renderers/three/settlement/ware-tool-icon-models";
import { createBalanceScale } from "./ui-action-icon-balance";
import { createRegisterBook } from "./ui-action-icon-book";
import { createCreditsBook } from "./ui-action-icon-credits";
import { UI_EMBLEM_ICONS } from "./ui-action-icon-emblems";
import { createHandshakeIcon } from "./ui-action-icon-handshake";
import { createInventoryPouchIcon } from "./ui-action-icon-inventory";
import { UI_ISLAND_ICONS } from "./ui-action-icon-islands";
import {
  brickMaterial,
  group,
  type Paint,
  paintedMaterial,
  polygon,
  put,
  rockGeometry,
  slab,
  surfaces
} from "./ui-action-icon-kit";
import { createMusicPlayerIcon } from "./ui-action-icon-music";
import {
createMusicLoopIcon,
  createMusicNextIcon, createMusicPauseIcon,   createMusicPlayIcon, createMusicPreviousIcon,
createMusicRepeatIcon, createMusicStopIcon} from "./ui-action-icon-music-controls";
import {
  createDocumentArrow,
  createRoadTile,
  createTerritoryTile
} from "./ui-action-icon-scenes";
import { createCreditsScroll } from "./ui-action-icon-scroll";
import { createSkullIcon } from "./ui-action-icon-skull";
import { createMapEditorIcon } from "./ui-action-icon-surveyor";

/** Original 3D subjects for the HUD action icons; every builder returns a fresh group. */
const tool = (id: string) => createToolIconModel(id).root;

/** Build: a staggered brick wall with mortar and a claw hammer leaning across it. */
const build = () => {
  const root = new Group();
  const brick = brickMaterial();
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4 - (row % 2); column++) {
      const x = (column - 1.5 + (row % 2) * 0.5) * 0.3;
      put(root, new BoxGeometry(0.28, 0.13, 0.2), brick, [x, row * 0.145 - 0.2, 0]);
    }
  put(root, new BoxGeometry(1.2, 0.56, 0.17), surfaces.stone, [0, 0.01, -0.02]);
  const hammer = tool("hammer");
  hammer.scale.setScalar(1.25);
  hammer.position.set(0.25, 0.25, 0.2);
  hammer.rotation.set(0, 0, -0.2);
  root.add(hammer);
  return root;
};

const paintMap: Paint = (context, width, height) => {
  context.fillStyle = "#ead7a4";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#3f8fb0";
  context.fillRect(width * 0.04, height * 0.06, width * 0.92, height * 0.88);
  context.fillStyle = "#e5cf93";
  context.beginPath();
  context.ellipse(width * 0.48, height * 0.5, width * 0.3, height * 0.34, 0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#6c9f48";
  context.beginPath();
  context.ellipse(width * 0.47, height * 0.5, width * 0.24, height * 0.27, 0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#8a7a62";
  for (const [x, y] of [
    [0.4, 0.4],
    [0.46, 0.36],
    [0.52, 0.42]
  ]) {
    context.beginPath();
    context.moveTo(width * x!, height * y! - 14);
    context.lineTo(width * x! + 12, height * y! + 8);
    context.lineTo(width * x! - 12, height * y! + 8);
    context.fill();
  }
  context.strokeStyle = "#a3241e";
  context.lineWidth = 5;
  context.setLineDash([10, 8]);
  context.beginPath();
  context.moveTo(width * 0.1, height * 0.85);
  context.quadraticCurveTo(width * 0.3, height * 0.6, width * 0.55, height * 0.62);
  context.stroke();
  context.setLineDash([]);
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(width * 0.52, height * 0.58);
  context.lineTo(width * 0.6, height * 0.68);
  context.moveTo(width * 0.6, height * 0.58);
  context.lineTo(width * 0.52, height * 0.68);
  context.stroke();
};

/** Map: an unrolled parchment chart between two rolls, weighted by a brass compass. */
const map = () => {
  const root = new Group();
  const chart = paintedMaterial(256, 192, paintMap);
  const sheet = new PlaneGeometry(1.3, 0.95, 24, 8),
    position = sheet.getAttribute("position");
  for (let index = 0; index < position.count; index++)
    position.setZ(index, Math.sin(position.getX(index) * 6) * 0.025);
  sheet.computeVertexNormals();
  put(root, sheet, chart);
  for (const side of [-1, 1]) {
    put(root, new CylinderGeometry(0.075, 0.075, 1.02, 24), surfaces.paper, [side * 0.68, 0, 0.05]);
    for (const end of [-1, 1])
      put(root, new SphereGeometry(0.05, 14, 10), surfaces.darkWood, [
        side * 0.68,
        end * 0.53,
        0.05
      ]);
  }
  const compass = group(root, [0.42, -0.3, 0.1], [Math.PI / 2, 0, 0]);
  put(compass, new CylinderGeometry(0.17, 0.17, 0.05, 32), surfaces.brass);
  put(compass, new CylinderGeometry(0.14, 0.14, 0.052, 32), surfaces.paper);
  put(
    compass,
    new ConeGeometry(0.04, 0.24, 4),
    surfaces.wax,
    [0, 0.03, -0.06],
    [-Math.PI / 2, 0, 0]
  );
  put(
    compass,
    new ConeGeometry(0.04, 0.24, 4),
    surfaces.iron,
    [0, 0.03, 0.06],
    [Math.PI / 2, 0, 0]
  );
  return root;
};

const gearShape = (teeth: number, outer: number, inner: number, hole: number) => {
  const shape = new Shape();
  for (let step = 0; step < teeth * 4; step++) {
    const angle = (step / (teeth * 4)) * Math.PI * 2,
      radius = step % 4 < 2 ? outer : inner;
    if (step) shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  shape.closePath();
  shape.holes.push(new Path().absarc(0, 0, hole, 0, Math.PI * 2, true));
  return shape;
};

/** Settings / menu: a bronze cog meshing with a smaller steel cog, each with spokes and a hub. */
const gear = () => {
  const root = new Group();
  put(root, slab(gearShape(10, 0.5, 0.4, 0.14), 0.14, 0.025), [surfaces.bronze, surfaces.gold]);
  put(root, new TorusGeometry(0.3, 0.03, 10, 48), surfaces.gold, [0, 0, 0.09]);
  put(
    root,
    new CylinderGeometry(0.13, 0.13, 0.2, 32),
    surfaces.steel,
    [0, 0, 0],
    [Math.PI / 2, 0, 0]
  );
  put(
    root,
    new CylinderGeometry(0.06, 0.06, 0.22, 6),
    surfaces.iron,
    [0, 0, 0],
    [Math.PI / 2, 0, 0]
  );
  const small = group(root, [0.56, 0.5, -0.08], [0, 0, 0.2]);
  put(small, slab(gearShape(7, 0.3, 0.22, 0.08), 0.1, 0.02), [surfaces.steel, surfaces.steel]);
  put(
    small,
    new CylinderGeometry(0.08, 0.08, 0.14, 24),
    surfaces.brass,
    [0, 0, 0],
    [Math.PI / 2, 0, 0]
  );
  return root;
};

/** News: a polished gold bell under a wooden yoke, clapper showing, with a red enamel alert stud. */
const notice = () => {
  const root = new Group();
  const profile = [
    [0, 0.62],
    [0.1, 0.6],
    [0.18, 0.52],
    [0.22, 0.3],
    [0.27, 0.08],
    [0.38, -0.06],
    [0.42, -0.12],
    [0.4, -0.15],
    [0, -0.15]
  ].map(([x, y]) => new Vector2(x!, y!));
  put(root, new LatheGeometry(profile, 48), surfaces.gold);
  put(
    root,
    new TorusGeometry(0.4, 0.03, 10, 48),
    surfaces.brass,
    [0, -0.12, 0],
    [Math.PI / 2, 0, 0]
  );
  put(root, new SphereGeometry(0.09, 20, 14), surfaces.iron, [0, -0.22, 0]);
  put(root, new TorusGeometry(0.08, 0.03, 10, 24), surfaces.brass, [0, 0.68, 0]);
  put(root, new BoxGeometry(0.7, 0.09, 0.12), surfaces.darkWood, [0, 0.78, 0]);
  const alert = group(root, [0.34, 0.5, 0.2]);
  put(alert, new SphereGeometry(0.15, 24, 16), surfaces.enamel);
  put(alert, new BoxGeometry(0.04, 0.12, 0.04), surfaces.paper, [0, 0.03, 0.14]);
  put(alert, new SphereGeometry(0.024, 10, 8), surfaces.paper, [0, -0.07, 0.14]);
  return root;
};

/** Heart silhouette shared by the support icon's gold casing and enamel face. */
const heartShape = (scale = 1) => {
  const shape = new Shape();
  const s = scale;
  shape.moveTo(0, -0.48 * s);
  shape.bezierCurveTo(-0.1 * s, -0.34 * s, -0.46 * s, -0.12 * s, -0.46 * s, 0.12 * s);
  shape.bezierCurveTo(-0.46 * s, 0.4 * s, -0.12 * s, 0.48 * s, 0, 0.28 * s);
  shape.bezierCurveTo(0.12 * s, 0.48 * s, 0.46 * s, 0.4 * s, 0.46 * s, 0.12 * s);
  shape.bezierCurveTo(0.46 * s, -0.12 * s, 0.1 * s, -0.34 * s, 0, -0.48 * s);
  return shape;
};

/** Support: a gold-rimmed red enamel heart bank with a coin slot and a donated gold coin. */
const support = () => {
  const root = new Group();
  put(root, slab(heartShape(1.05), 0.16, 0.04), surfaces.gold, [0, 0, -0.02]);
  put(root, slab(heartShape(0.88), 0.12, 0.03), surfaces.enamel, [0, 0, 0.06]);
  put(root, new BoxGeometry(0.24, 0.035, 0.045), surfaces.iron, [0, 0.19, 0.14]);
  const coin = put(root, new CylinderGeometry(0.14, 0.14, 0.04, 32), surfaces.gold,
    [0.24, 0.38, 0.2], [1.18, 0, -0.34]);
  put(coin, new TorusGeometry(0.12, 0.016, 10, 32), surfaces.brass, [0, 0, 0.024]);
  put(root, new CylinderGeometry(0.09, 0.09, 0.035, 24), surfaces.gold, [-0.3, -0.46, 0.18],
    [1.35, 0, 0.24]);
  root.userData.iconView = [0.4, 0.3, 2];
  return root;
};

/** Cancel / close: a lacquered red cross on a gold backing. */
const cancel = () => {
  const root = new Group();
  const cross = (width: number, reach: number) =>
    polygon([
      [-reach, -reach + width],
      [-width, 0],
      [-reach, reach - width],
      [-reach + width, reach],
      [0, width],
      [reach - width, reach],
      [reach, reach - width],
      [width, 0],
      [reach, -reach + width],
      [reach - width, -reach],
      [0, -width],
      [-reach + width, -reach]
    ]);
  put(root, slab(cross(0.16, 0.5), 0.14, 0.04), surfaces.enamel, [0, 0, 0.04]);
  put(root, slab(cross(0.2, 0.55), 0.06, 0.02), surfaces.gold, [0, 0, -0.05]);
  return root;
};

/** Geologist: a forged pickaxe resting against an ore boulder with gold crystals. */
const geologist = () => {
  const root = new Group();
  const ore = new MeshStandardMaterial({ color: "#5d5048", flatShading: true, roughness: 0.8 });
  const boulder = put(root, rockGeometry(3), ore, [0.15, -0.25, 0]);
  boulder.scale.set(0.42, 0.32, 0.36);
  for (let crystal = 0; crystal < 9; crystal++) {
    const angle = crystal * 2.3,
      height = 0.1 + (crystal % 3) * 0.1;
    put(
      root,
      new ConeGeometry(0.045, 0.14, 6),
      surfaces.gold,
      [0.15 + Math.cos(angle) * 0.25, -0.2 + height * 0.6, 0.2 + Math.sin(angle) * 0.1],
      [0.3, 0, Math.cos(angle) * 0.6]
    );
  }
  const pick = tool("pickaxe");
  pick.position.set(-0.18, 0.2, 0.25);
  pick.scale.setScalar(1.15);
  root.add(pick);
  return root;
};

/**
 * Scout: a stout brass spyglass laid on the diagonal, tilted so its big objective lens faces the viewer.
 * Fat sections and wide gold collars keep the silhouette solid at the 23 px build-tool size.
 */
const scout = () => {
  const holder = new Group();
  const root = group(holder, [0, 0, 0], [-0.5, 0, 0.78]);
  const sections = [
    [0.21, 0.42, -0.2, surfaces.leather],
    [0.17, 0.3, 0.15, surfaces.brass],
    [0.135, 0.24, 0.41, surfaces.brass]
  ] as const;
  for (const [radius, length, y, surface] of sections) {
    put(root, new CylinderGeometry(radius, radius, length, 40), surface, [0, y, 0]);
    for (const end of [-1, 1])
      put(
        root,
        new TorusGeometry(radius + 0.006, 0.028, 12, 40),
        surfaces.gold,
        [0, y + (end * length) / 2, 0],
        [Math.PI / 2, 0, 0]
      );
  }
  put(root, new CylinderGeometry(0.25, 0.21, 0.14, 40), surfaces.brass, [0, -0.47, 0]);
  put(root, new TorusGeometry(0.245, 0.03, 12, 40), surfaces.gold, [0, -0.54, 0], [Math.PI / 2, 0, 0]);
  put(
    root,
    new SphereGeometry(0.21, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    surfaces.glass,
    [0, -0.54, 0],
    [Math.PI, 0, 0]
  ).scale.y = 0.45;
  put(root, new CylinderGeometry(0.08, 0.095, 0.12, 24), surfaces.darkWood, [0, 0.59, 0]);
  return holder;
};

/** Drag grip: six gold rivets set in a dark leather strap. */
const drag = () => {
  const root = new Group();
  put(root, new BoxGeometry(0.5, 0.78, 0.06), surfaces.leather);
  for (const x of [-0.12, 0.12])
    for (const y of [-0.25, 0, 0.25])
      put(
        root,
        new SphereGeometry(0.075, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        surfaces.gold,
        [x, y, 0.03],
        [Math.PI / 2, 0, 0]
      );
  return root;
};

const crate = (parent: Group, position: readonly number[], size: number) => {
  const planks = paintedMaterial(64, 64, (context, width, height) => {
    context.fillStyle = "#b07a44";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#6b4426";
    for (let line = 1; line < 4; line++) context.fillRect(0, (line * height) / 4 - 1, width, 2);
    context.fillStyle = "#8a5a30";
    context.fillRect(0, 0, width, 7);
    context.fillRect(0, height - 7, width, 7);
    context.fillRect(0, 0, 7, height);
    context.fillRect(width - 7, 0, 7, height);
  });
  return put(parent, new BoxGeometry(size, size, size), planks, position);
};

/** Storehouse: stacked crates, a hooped barrel and a grain sack. */
const warehouse = () => {
  const root = new Group();
  crate(root, [-0.25, -0.2, 0], 0.44);
  crate(root, [0.22, -0.24, 0.1], 0.36);
  crate(root, [-0.15, 0.24, -0.04], 0.4).rotation.y = 0.3;
  const barrel = group(root, [0.42, -0.12, 0.38]);
  put(
    barrel,
    new LatheGeometry(
      [
        [0, -0.27],
        [0.16, -0.27],
        [0.2, 0],
        [0.16, 0.27],
        [0, 0.27]
      ].map(([x, y]) => new Vector2(x!, y!)),
      32
    ),
    surfaces.wood
  );
  for (const y of [-0.17, 0.17])
    put(
      barrel,
      new TorusGeometry(0.185, 0.014, 8, 32),
      surfaces.iron,
      [0, y, 0],
      [Math.PI / 2, 0, 0]
    );
  const sack = put(root, new SphereGeometry(0.2, 24, 16), surfaces.sack, [-0.5, -0.27, 0.36]);
  sack.scale.set(1, 1.15, 0.9);
  put(
    root,
    new TorusGeometry(0.06, 0.02, 8, 16),
    surfaces.darkWood,
    [-0.5, -0.04, 0.36],
    [Math.PI / 2, 0, 0]
  );
  return root;
};

/** Demolish: a sledgehammer over broken, scattered bricks. */
const demolish = () => {
  const root = new Group();
  const brick = brickMaterial();
  for (let piece = 0; piece < 9; piece++) {
    const angle = piece * 2.2,
      reach = piece < 3 ? 0.1 : 0.34;
    put(
      root,
      new BoxGeometry(0.28, 0.13, 0.18),
      brick,
      [Math.cos(angle) * reach, -0.38 + (piece < 3 ? 0.12 : 0), Math.sin(angle) * reach * 0.6],
      [piece * 0.3, piece * 1.1, piece * 0.5]
    ).scale.setScalar(piece % 2 ? 1 : 0.6);
  }
  for (let dust = 0; dust < 6; dust++)
    put(root, rockGeometry(dust), surfaces.stone, [
      Math.cos(dust) * 0.4,
      -0.42,
      Math.sin(dust) * 0.25
    ]).scale.setScalar(0.05);
  const sledge = group(root, [0.05, 0.1, 0.1], [0, 0, -0.6]);
  put(sledge, new CylinderGeometry(0.035, 0.04, 1, 16), surfaces.wood);
  put(sledge, new BoxGeometry(0.46, 0.2, 0.2), surfaces.iron, [0, 0.5, 0]);
  for (const side of [-1, 1])
    put(sledge, new BoxGeometry(0.04, 0.22, 0.22), surfaces.steel, [side * 0.24, 0.5, 0]);
  return root;
};

/** Sound: a curved war horn with gold bands, mouthpiece and baldric strap. */
const sound = () => {
  const root = new Group();
  const curve = new CatmullRomCurve3([
    new Vector3(-0.55, -0.25, 0),
    new Vector3(-0.2, -0.35, 0),
    new Vector3(0.2, -0.2, 0),
    new Vector3(0.45, 0.2, 0)
  ]);
  for (let step = 0; step < 12; step++) {
    const t = step / 12,
      radius = 0.03 + t ** 1.6 * 0.17;
    const point = curve.getPoint(t + 0.5 / 12),
      tangent = curve.getTangent(t + 0.5 / 12);
    const segment = put(
      root,
      new CylinderGeometry(radius + 0.012, radius, 0.1, 28, 1, true),
      surfaces.leather,
      point.toArray()
    );
    segment.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
    if (step % 4 === 3) {
      const band = put(
        root,
        new TorusGeometry(radius + 0.012, 0.016, 8, 28),
        surfaces.gold,
        point.toArray()
      );
      band.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tangent);
    }
  }
  const bell = put(
    root,
    new TorusGeometry(0.2, 0.03, 10, 32),
    surfaces.gold,
    curve.getPoint(1).toArray()
  );
  bell.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), curve.getTangent(1));
  put(root, new SphereGeometry(0.045, 16, 10), surfaces.brass, curve.getPoint(0).toArray());
  return root;
};

/** Weather: a glowing sun behind a soft cloud with falling rain drops. */
/** One side-profile bust; long hair adds the female silhouette behind the same head and shoulder line. */
const avatarProfile = (longHair: boolean) => {
  const shape = new Shape();
  shape.moveTo(-0.2, -0.62);
  shape.bezierCurveTo(-0.42, -0.54, -0.48, -0.38, -0.42, -0.18);
  if (longHair) {
    shape.bezierCurveTo(-0.64, -0.04, -0.62, 0.2, -0.44, 0.3);
  } else {
    shape.bezierCurveTo(-0.5, -0.02, -0.48, 0.22, -0.32, 0.32);
  }
  shape.bezierCurveTo(-0.18, 0.44, 0.1, 0.46, 0.24, 0.34);
  shape.lineTo(0.26, 0.2);
  shape.lineTo(0.4, 0.1);
  shape.lineTo(0.29, 0.04);
  shape.lineTo(0.31, -0.02);
  shape.lineTo(0.27, -0.1);
  shape.bezierCurveTo(0.16, -0.18, 0.1, -0.28, 0.12, -0.42);
  shape.bezierCurveTo(0.26, -0.5, 0.28, -0.58, 0.3, -0.62);
  shape.closePath();
  return shape;
};

/** Customization: two overlapping male/female profile silhouettes in bronze and gold. */
const customization = () => {
  const root = new Group();
  const male = put(root, slab(avatarProfile(false), 0.14, 0.025), [surfaces.bronze, surfaces.gold],
    [-0.18, 0.02, -0.12], [0, 0, -0.08]);
  male.scale.setScalar(0.92);
  put(root, slab(avatarProfile(true), 0.15, 0.025), [surfaces.brass, surfaces.gold],
    [0.2, -0.02, 0.08], [0, 0, 0.08]);
  return root;
};

/** Weather: a glowing sun behind a soft cloud with falling rain drops. */
const weather = () => {
  const root = new Group();
  put(root, new SphereGeometry(0.3, 32, 20), surfaces.sun, [-0.2, 0.25, -0.2]);
  for (let ray = 0; ray < 10; ray++) {
    const angle = (ray / 10) * Math.PI * 2;
    put(
      root,
      new ConeGeometry(0.05, 0.16, 8),
      surfaces.sun,
      [-0.2 + Math.cos(angle) * 0.42, 0.25 + Math.sin(angle) * 0.42, -0.2],
      [0, 0, angle - Math.PI / 2]
    );
  }
  for (const [x, y, radius] of [
    [-0.25, -0.05, 0.2],
    [0, 0.05, 0.27],
    [0.27, -0.02, 0.22],
    [0.45, -0.1, 0.15],
    [0.05, -0.13, 0.2]
  ] as const)
    put(root, new SphereGeometry(radius, 24, 16), surfaces.cloud, [x, y, 0.1]);
  for (const x of [-0.2, 0.08, 0.36]) {
    const drop = put(root, new SphereGeometry(0.05, 16, 10), surfaces.rain, [x, -0.46, 0.2]);
    drop.scale.y = 1.6;
    put(root, new ConeGeometry(0.043, 0.09, 12), surfaces.rain, [x, -0.36, 0.2]);
  }
  return root;
};

const exportFile = () => createDocumentArrow("out");
const importFile = () => createDocumentArrow("in");

/** A raised enamel checkmark for applying editor changes and validating authored settings. */
const apply = () => {
  const root = new Group();
  const shape = polygon([[-.5, .02], [-.32, .2], [-.09, -.03], [.34, .49],
    [.53, .31], [-.07, -.43]]);
  put(root, slab(shape, .13, .035), surfaces.gold);
  const face = put(root, slab(shape, .025, .018),
    new MeshStandardMaterial({ color: "#3baf8d", metalness: .3, roughness: .26 }), [0, 0, .1]);
  face.scale.set(.81, .81, 1);
  return root;
};

export const UI_ACTION_ICONS: Record<string, () => Group> = {
  ...UI_EMBLEM_ICONS,
  ...UI_ISLAND_ICONS,
  apply,
  build,
  cancel,
  credits: createCreditsBook,
  customization,
  demolish,
  dirt: () => createRoadTile(false),
  drag,
  export: exportFile,
  geologist,
  handshake: createHandshakeIcon,
  skull: createSkullIcon,
  import: importFile,
  inventory: createInventoryPouchIcon,
  map,
  mapEditor: createMapEditorIcon,
  market: createBalanceScale,
  menu: gear,
  musicPlayer: createMusicPlayerIcon,
  musicPlay: createMusicPlayIcon,
  musicPause: createMusicPauseIcon,
  musicStop: createMusicStopIcon,
  musicPrevious: createMusicPreviousIcon,
  musicNext: createMusicNextIcon,
  musicRepeat: createMusicRepeatIcon,
  musicLoop: createMusicLoopIcon,
  notice,
  register: createRegisterBook,
  scout,
  scroll: createCreditsScroll,
  sound,
  stone: () => createRoadTile(true),
  support,
  territory: createTerritoryTile,
  warehouse,
  weather
};

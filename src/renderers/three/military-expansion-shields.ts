import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingFirstNation } from "../../render-common/workers/worker-nation";
import { createFinishes } from "./military-equipment-finishes";
import { curvedPlate, ovalPlate } from "./military-equipment-geometry";
import { createEquipmentParts } from "./military-equipment-mesh";

type Forge = { detailed: boolean; finishes: ReturnType<typeof createFinishes>;
  parts: ReturnType<typeof createEquipmentParts> };

const handle = ({ detailed, finishes, parts }: Forge, front: number) => {
  for (const side of [-1, 1]) parts.add(new BoxGeometry(.025, .12, front - .01), finishes.darkWood,
    { position: [side * .062, 0, (front + .01) / 2] });
  parts.add(new CylinderGeometry(.013, .013, .15, detailed ? 8 : 5), finishes.leather,
    { position: [0, 0, .015], rotation: [0, 0, Math.PI / 2] });
};

const roundShield = (forge: Forge, persian: boolean) => {
  const { detailed, finishes, parts } = forge, radius = persian ? .225 : .235;
  const front = .075, depth = .016;
  const plate = ovalPlate({ back: front, bulge: r => .026 * (1 - r * r), radiusX: radius,
    radiusY: radius, rings: detailed ? 3 : 1, segments: detailed ? 28 : 12, thickness: depth });
  parts.add(plate.back, finishes.leather);
  let face = plate.front;
  if (!persian) {
    face.deleteAttribute("normal");
    face = mergeVertices(plate.front);
    face.computeVertexNormals();
    plate.front.dispose();
  }
  parts.add(face, persian ? { color: "#355da0", rough: .88 } :
    { color: "#ffffff", paint: "indigenousHide", rough: .94 });
  parts.add(plate.rim, persian ? finishes.bronze : finishes.leather);
  handle(forge, front);
  const count = detailed ? 20 : 8;
  for (let stitch = 0; stitch < count; stitch++) {
    const angle = stitch / count * Math.PI * 2, x = Math.cos(angle), y = Math.sin(angle);
    parts.add(new BoxGeometry(persian ? .009 : .016, .005, .011),
      persian ? finishes.gold : finishes.bone,
      { position: [x * radius * .92, y * radius * .92, front + depth + .005],
        rotation: [0, 0, angle] });
  }
  if (persian) {
    parts.add(new SphereGeometry(.058, detailed ? 14 : 6, detailed ? 8 : 3), finishes.bronze,
      { position: [0, 0, front + depth + .01], scale: [1, 1, .65] });
    if (detailed) parts.add(new TorusGeometry(.075, .004, 4, 20), finishes.gold,
      { position: [0, 0, front + depth + .025] });
    for (let petal = 0; petal < 8; petal++) {
      const angle = petal / 8 * Math.PI * 2;
      parts.add(new SphereGeometry(.017, detailed ? 8 : 4, detailed ? 5 : 2), finishes.gold,
        { position: [Math.sin(angle) * .091, Math.cos(angle) * .091, front + depth + .026],
          scale: [.65, 1.8, .2], rotation: [0, 0, -angle] });
    }
  } else {
    const ochre = { color: "#8a4729", rough: .9 };
    parts.add(new CylinderGeometry(.045, .045, .003, detailed ? 12 : 6), ochre,
      { position: [0, 0, front + depth + .027], rotation: [Math.PI / 2, 0, 0] });
    for (let ray = 0; ray < 8; ray++) {
      const angle = ray / 8 * Math.PI * 2;
      parts.add(new BoxGeometry(.012, .035, .003), ochre,
        { position: [Math.sin(angle) * .072, Math.cos(angle) * .072, front + depth + .025],
          rotation: [0, 0, -angle] });
    }
    if (detailed) for (const side of [-1, 1]) parts.add(new BoxGeometry(.008, .082, .005), finishes.leather,
      { position: [side * .12, -.233, front + .005], rotation: [0, 0, side * .15] });
  }
};

const wovenShield = (forge: Forge) => {
  const { detailed, finishes, parts } = forge, front = .075, width = .32, height = .43;
  parts.add(new BoxGeometry(width, height, .014), { color: "#bc995b", grain: true, rough: .92 },
    { position: [0, 0, front] });
  const strips = detailed ? 16 : 6;
  for (let strip = 0; strip < strips; strip++) {
    const fraction = (strip + .5) / strips - .5;
    parts.add(new BoxGeometry(width - .012, height / strips * .58, .004),
      { color: strip % 2 ? "#c5a86b" : "#ab8a4d", grain: true, rough: .94 },
      { position: [0, fraction * height, front + .009] });
    parts.add(new BoxGeometry(width / strips * .34, height - .015, .003),
      { color: "#d3b775", rough: .94 }, { position: [fraction * width, 0, front + .012] });
  }
  for (const side of [-1, 1]) {
    parts.add(new BoxGeometry(.018, height + .018, .022), finishes.darkWood,
      { position: [side * width / 2, 0, front] });
    parts.add(new BoxGeometry(width + .018, .018, .022), finishes.darkWood,
      { position: [0, side * height / 2, front] });
    parts.add(new BoxGeometry(.025, height - .035, .02), finishes.wood,
      { position: [side * .1, 0, front - .017] });
  }
  handle(forge, front - .027);
  // A complete stepped meander, attached to the woven board, rather than a generic dye stripe.
  const red = { color: "#9b3c2c", rough: .9 };
  const strokes = [[-.09, -.095, .09, .016], [-.127, -.035, .016, .12],
    [-.04, .017, .19, .016], [.047, .075, .016, .13], [.09, .132, .1, .016],
    [.132, .08, .016, .12]] as const;
  for (const [x, y, w, h] of strokes) parts.add(new BoxGeometry(w, h, .003), red,
    { position: [x, y, front + .016] });
  for (const side of [-1, 1]) parts.add(new BoxGeometry(.026, .025, .026), finishes.dyed,
    { position: [side * width / 2, height / 2, front + .003] });
};

const chineseShield = (forge: Forge) => {
  const { detailed, finishes, parts } = forge;
  const fret = (x: number, y: number, width: number, height: number) => {
    const geometry = new BoxGeometry(width, height, .004, detailed ? 6 : 2);
    const position = geometry.getAttribute("position");
    for (let at = 0; at < position.count; at++) {
      const across = position.getX(at) + x;
      position.setZ(at, position.getZ(at) + .092 + .035 * (1 - (2 * across / .31) ** 2));
    }
    geometry.computeVertexNormals();
    parts.add(geometry, finishes.gold, { position: [x, y, 0] });
  };
  const plate = curvedPlate({ back: .075, columns: detailed ? 8 : 3, curve: .035,
    height: .44, thickness: .015, width: .31 });
  parts.add(plate.back, finishes.darkWood);
  parts.add(plate.front, { color: "#8d3027", metal: .08, rough: .48 });
  parts.add(plate.rim, finishes.leather);
  for (const side of [-1, 1]) parts.add(new BoxGeometry(.026, .44, .02), finishes.bronze,
    { position: [side * .146, 0, .091] });
  for (const side of [-1, 1]) parts.add(new BoxGeometry(.3, .022, .018), finishes.lacquer,
    { position: [0, side * .208, .105] });
  parts.add(new SphereGeometry(.049, detailed ? 12 : 6, detailed ? 7 : 3), finishes.bronze,
    { position: [0, 0, .125], scale: [1, 1, .45] });
  for (const side of [-1, 1]) for (const top of [-1, 1]) {
    fret(side * .086, top * .152, .085, .012);
    fret(side * .049, top * .127, .012, .065);
    fret(side * .063, top * .101, .04, .012);
  }
  parts.add(new BoxGeometry(.02, .055, .018), finishes.dyed, { position: [0, -.18, .125] });
  if (detailed) for (const x of [-.145, .145]) for (const y of [-.17, 0, .17])
    parts.add(new SphereGeometry(.007, 6, 3), finishes.gold, { position: [x, y, .107] });
  handle(forge, .075);
};

/** Held board faces +Z; the palm is at origin behind a physical stand-off grip. */
export const buildExpansionShield = (nation: BuildingFirstNation, detailed: boolean) => {
  const parts = createEquipmentParts(), forge = { detailed, finishes: createFinishes(detailed), parts };
  if (nation === "chinese") chineseShield(forge);
  else if (nation === "maya") wovenShield(forge);
  else roundShield(forge, nation === "persian");
  return parts.build();
};

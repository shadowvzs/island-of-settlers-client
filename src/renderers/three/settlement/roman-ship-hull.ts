import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Group, Mesh, TubeGeometry, Vector3 } from "three";

import { SHIP_DECK, SHIP_DECK_RIGGING } from "../../../render-common/ships/ship-deck-layout";
import { addShipDeck, SHIP_DECK_LEVELS } from "./ship-deck-planking";
import { bandSections, hullDeckOutline, type HullForm } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";
import type { ShipMaterialName } from "./ship-materials";
import { createShipOrnamentParts } from "./ship-ornaments";

/** Half beam of the Roman merchant hull at `t` (0 stern … 1 bow); the shared deck follows it. */
export const romanBeam = (t: number) => Math.max(0.035, Math.sin(t * Math.PI) ** 0.7 * 0.42);

const rings = (kit: ShipKit) => kit.detailed ? 19 : 7;
const sections = (kit: ShipKit) => kit.detailed ? 12 : 6;

/** The merchant hull's half-ellipse sections as a loft form, for the deck that closes onto its skin. */
const ROMAN_HULL: HullForm = {
  beam: romanBeam,
  depth: () => .35,
  section: a => [Math.cos(a * Math.PI / 2), Math.sin(a * Math.PI / 2)],
  sheer: t => .2 + Math.abs(t - .5) ** 3 * .6
};

/** The deck outline inside the merchant hull, along its mesh rings and section vertices. */
const romanDeckOutline = (kit: ShipKit) =>
  hullDeckOutline(ROMAN_HULL, rings(kit), bandSections(0, 1, sections(kit) / 2), SHIP_DECK_LEVELS);

/** The rounded merchant hull, one loft of half-ellipse sections. */
const romanHullGeometry = (kit: ShipKit) => {
  const count = rings(kit), sides = sections(kit);
  const hull = kit.temp(new BufferGeometry()), vertices: number[] = [], indices: number[] = [];
  for (let ring = 0; ring < count; ring++) {
    const t = ring / (count - 1), z = (t - 0.5) * 2.2, beam = romanBeam(t);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI;
      vertices.push(Math.cos(angle) * beam, 0.20 - Math.sin(angle) * 0.35 + Math.abs(t - 0.5) ** 3 * 0.6, z);
      if (ring < count - 1 && side < sides) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  hull.setAttribute("uv", new Float32BufferAttribute(vertices.flatMap((_, i) => i % 3 ? [] :
    [(vertices[i + 2]! + 1.2) * 2, (vertices[i + 1]! + 0.2) * 3]), 2));
  hull.setAttribute("position", new Float32BufferAttribute(vertices, 3)); hull.setIndex(indices);
  hull.computeVertexNormals();
  return hull;
};

/** Construction frames: the ribs show before the planking closes them in (shared by every hull style). */
export const createShipRibGeometries = (detailed: boolean, own: <T extends BufferGeometry>(geometry: T) => T) =>
  Array.from({ length: 7 }, (_, index) => {
    const i = index + 1, z = (i / 8 - 0.5) * 2, width = Math.sin(i / 8 * Math.PI) * 0.72;
    const points = [[-width / 2, 0.2], [-width * 0.4, 0], [0, -0.12], [width * 0.4, 0], [width / 2, 0.2]];
    const curve = new CatmullRomCurve3(points.map(([x, y]) => new Vector3(x!, y!, z)));
    return own(new TubeGeometry(curve, detailed ? 10 : 6, 0.022, 4, false));
  });

/** Sheer rails, bronze lines, stanchions, the red upper strakes and their bronze seals. */
const addSheerAndStrakes = (kit: ShipKit, planking: Group) => {
  const count = rings(kit), { add, curve, detailed, materials } = kit;
  for (const side of [-1, 1]) {
    const sheer = Array.from({ length: count }, (_, index) => {
      const t = index / (count - 1);
      return [side * romanBeam(t), .22 + Math.abs(t - .5) ** 3 * .6, (t - .5) * 2.2];
    });
    curve(planking, "trim", sheer, .018, detailed ? 24 : 8);
    if (!detailed) continue;
    curve(planking, "bronze", sheer.map(([x, y, z]) => [x! * 1.008, y! - .016, z!]), .004, 24);
    curve(planking, "bronze", sheer.map(([x, y, z]) => [x! * .986, y! - .10, z!]), .004, 24);
    curve(planking, "wood", sheer.map(([x, y, z]) => [x! * .97, y! + .10, z!]), .012, 24);
    for (const z of [-.65, -.3, .05, .4, .7]) {
      const beam = Math.sin((z / 2.2 + .5) * Math.PI) ** .7 * .42;
      add(planking, "wood", [.018, .11, .018], [side * beam * .97, .27, z]);
    }
  }
  // Red upper strakes follow the rounded hull; raised bronze seals sit outside the working deck.
  for (const side of [-1, 1]) {
    const positions: number[] = [], uvs: number[] = [], bandIndices: number[] = [];
    for (let ring = 0; ring < count; ring++) {
      const t = ring / (count - 1), beam = romanBeam(t);
      for (const angle of [.04, .38]) {
        positions.push(side * Math.cos(angle) * beam * 1.004, .20 - Math.sin(angle) * .35 + Math.abs(t - .5) ** 3 * .6,
          (t - .5) * 2.2);
        uvs.push(t * 3, angle / .38);
      }
      if (ring < count - 1) { const a = ring * 2; bandIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geometry = kit.temp(new BufferGeometry()); geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2)); geometry.setIndex(bandIndices);
    geometry.computeVertexNormals();
    kit.mesh(planking, "trim", geometry);
    if (detailed) for (const z of [-.68, -.37, -.06, .25, .56]) {
      const beam = Math.sin((z / 2.2 + .5) * Math.PI) ** .7 * .42, seal = new Mesh(kit.medallion, materials.bronze);
      seal.scale.set(.026, .004, .026); seal.rotation.z = Math.PI / 2; seal.position.set(side * beam, .127, z);
      planking.add(seal);
      const ring = new Mesh(kit.coinRing, materials.bronze); ring.scale.setScalar(.03); ring.rotation.y = Math.PI / 2;
      ring.position.copy(seal.position).x += side * .005; planking.add(ring);
    }
  }
};

/** The cargo hatch coaming round the shared hatch footprint (every nation's deck). */
export const addHatchCoaming = (kit: ShipKit, planking: Group, material: ShipMaterialName) => {
  for (const side of [-1, 1]) {
    kit.add(planking, material, [.022, .055, .36], [side * .19, .22, -.15]);
    kit.add(planking, material, [.36, .055, .022], [0, .22, -.15 + side * .18]);
  }
};

/** The hatch grating, below the deck-slot clearance (High). */
export const addHatchGrating = (kit: ShipKit, planking: Group, material: ShipMaterialName) => {
  for (let bar = 0; bar < 7; bar++) kit.add(planking, material, [.30, .012, .014], [0, .212, -.29 + bar * .043]);
  for (let bar = 0; bar < 7; bar++) kit.add(planking, material, [.014, .012, .30], [-.135 + bar * .045, .214, -.15]);
};

/** Mooring cleats with coiled ropes at the shared deck obstruction spots (ship-deck-layout.ts), High. */
export const addMooringCleats = (kit: ShipKit, planking: Group, post: ShipMaterialName, horn: ShipMaterialName) => {
  for (const z of [-.58, .45]) for (const side of [-1, 1]) {
    const beam = Math.sin((z / 2.2 + .5) * Math.PI) ** .7 * .42;
    kit.add(planking, post, [.018, .10, .018], [side * beam * .85, .255, z]);
    kit.add(planking, horn, [.060, .014, .020], [side * beam * .85, .30, z]);
    const coil = new Mesh(kit.coinRing, kit.materials.dark); coil.scale.set(.045, .045, .014);
    coil.rotation.x = Math.PI / 2; coil.position.set(side * beam * .75, .222, z + .06); planking.add(coil);
  }
};

/** Stern steering oar, hatch coaming, the raised quarterdeck under its canopy, cleats and coiled ropes. */
const addSternAndFittings = (kit: ShipKit, planking: Group, fittings: Group) => {
  const { add, curve, detailed } = kit;
  curve(fittings, "dark", [[.23, .36, -.72], [.38, .12, -.95], [.52, -.10, -1.13]], .013, 4);
  add(fittings, "wood", [.075, .035, .06], [.25, .32, -.75]);
  add(fittings, "wood", [.025, .15, .025], [.23, .255, -.75]);
  const paddle = add(fittings, "wood", [.10, .24, .035], [.52, -.17, -1.13]);
  paddle.rotation.set(.5, 0, .5);
  addHatchCoaming(kit, planking, "dark");
  // Accessible stern canopy with slatted roof, corner columns and open lattice railings.
  add(planking, "deck", [.50, .035, .20], [0, .2825, -.925]);
  for (let step = 0; step < 3; step++) add(planking, "wood", [.23, .025, .055], [0, .22 + step * .025, -.72 - step * .045]);
  for (const [x, z] of SHIP_DECK.canopy.posts) add(planking, "wood", [.025, SHIP_DECK.canopy.roofY - SHIP_DECK.floorY, .025],
    [x!, (SHIP_DECK.canopy.roofY + SHIP_DECK.floorY) / 2, z!]);
  for (const side of [-1, 1]) {
    add(planking, "trim", [.025, .06, .33], [side * .245, .58, -.865]);
    if (!detailed) continue;
    add(planking, "bronze", [.028, .006, .34], [side * .245, .613, -.865]);
    for (let n = 0; n < 7; n++) add(planking, "wood", [.014, .13, .014], [side * .235, .395, -.99 + n * .042]);
    add(planking, "wood", [.022, .025, .32], [side * .235, .47, -.865]);
  }
  const count = detailed ? 9 : 3;
  for (let board = 0; board < count; board++)
    add(planking, "wood", [.50 / count * .94, .018, .34], [(board - (count - 1) / 2) * .50 / count, SHIP_DECK.canopy.roofY, -.865]);
  if (!detailed) return;
  addHatchGrating(kit, planking, "wood");
  addMooringCleats(kit, planking, "dark", "bronze");
};

/** The original Roman merchant hull: planking, deck, sheer, red strakes, stern canopy and helm. */
export const buildRomanHull = (kit: ShipKit, planking: Group, fittings: Group = planking) => {
  kit.mesh(planking, "wood", romanHullGeometry(kit));
  addShipDeck(kit, planking, romanDeckOutline(kit));
  // Swept bow and raised stern frame the rounded merchant hull; no galley ram.
  kit.curve(planking, "trim", [[0, -.06, 1.03], [0, .26, 1.13], [0, .43, 1.22]], .035);
  kit.curve(planking, "trim", [[0, -.04, -1.03], [0, .33, -1.12], [0, .58, -1.2]], .035);
  addSheerAndStrakes(kit, planking);
  addSternAndFittings(kit, planking, fittings);
  for (const ornament of createShipOrnamentParts(kit.detailed, kit.temp, kit.materials)) planking.add(ornament);
};

/**
 * Sheets and mast stays lie aft of the billowed cloth, leaving its face unobstructed. The ratlines
 * (the level rungs) belong to the merchant ship; the other nations' ships only set the shrouds.
 */
export const addShipShrouds = (kit: ShipKit, rig: Group, ratlines = true) => {
  for (const points of SHIP_DECK_RIGGING) {
    const flat = points.length === 2 && Math.abs(points[0]![1]! - points[1]![1]!) < .0001;
    if (flat && !ratlines) continue;
    kit.curve(rig, "dark", points, flat ? .003 : .005, 4);
  }
};

/** Mast, square-sail yard and (High) the shrouds and ratlines. */
export const buildRomanRig = (kit: ShipKit, rig: Group) => {
  const mast = new Mesh(kit.pole, kit.materials.dark); mast.scale.set(0.03, 2.2, 0.03); mast.position.y = 1.25; rig.add(mast);
  const yard = kit.add(rig, "wood", [1.38, 0.045, 0.045], [0, 1.68, 0.05]); yard.rotation.z = -0.02;
  if (kit.detailed) addShipShrouds(kit, rig);
};

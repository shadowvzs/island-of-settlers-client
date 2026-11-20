import { BoxGeometry, type BufferGeometry,Group, Mesh, MeshStandardMaterial } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { RoadDecorationStoneFamily } from "../../shared/settlement/road-decoration-catalog";
import { createRoadDecorationStoneMaterial } from "./road-decoration-stone-material";
import { colourRomanStone, createRomanColumnMoulding, createRomanEggCarving,
  createRomanFlutedShaft, createRomanScrollDrum, createRomanVolute,
  type RomanColumnDetail, type RomanColumnOrder } from "./roman-column-geometry";

const baseProfiles = {
  doric: [[0, 0], [.335, 0], [.335, .105], [.30, .13], [.30, .165], [.235, .19], [.223, .25]],
  ionic: [[0, 0], [.34, 0], [.34, .105], [.29, .105], [.29, .14], [.255, .16],
    [.27, .195], [.255, .23], [.228, .25], [.228, .275], [.255, .295], [.24, .325], [.215, .36]]
} as const;

const doricCapital = [[.175, 2.73], [.19, 2.73], [.19, 2.77], [.212, 2.78],
  [.212, 2.81], [.235, 2.84], [.27, 2.89], [.304, 2.94], [.307, 2.98]] as const;
const ionicCapital = [[.175, 2.85], [.195, 2.85], [.195, 2.885], [.23, 2.91],
  [.25, 2.945], [.25, 2.99], [.285, 3.015], [0, 3.015]] as const;

const translatedBox = (width: number, height: number, depth: number, y: number,
  detail: RomanColumnDetail) => {
  const geometry = detail === "high"
    ? new RoundedBoxGeometry(width, height, depth, 1, .009)
    : new BoxGeometry(width, height, depth);
  if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count },
    (_, index) => index));
  geometry.translate(0, y, 0);
  return geometry;
};

export const createRomanColumnGeometry = (order: RomanColumnOrder, detail: RomanColumnDetail) => {
  const ionic = order === 1, parts: BufferGeometry[] = [
    createRomanFlutedShaft(detail, ionic),
    createRomanColumnMoulding(ionic ? baseProfiles.ionic : baseProfiles.doric, detail),
    createRomanColumnMoulding(ionic ? ionicCapital : doricCapital, detail),
    translatedBox(ionic ? .76 : .64, .12, ionic ? .48 : .64, ionic ? 3.205 : 3.04, detail)
  ];
  // Square abacus is load-bearing architecture, not an unrelated display pedestal.
  if (ionic) {
    parts.push(translatedBox(.55, .22, .40, 3.05, detail));
    for (const side of [-1, 1]) {
      parts.push(createRomanScrollDrum(side, detail));
      for (const front of [-1, 1]) parts.push(createRomanVolute(side, front, detail));
    }
    if (detail !== "far") for (let index = 0; index < 7; index++) {
      const egg = createRomanEggCarving(index, detail);
      parts.push(egg, egg.clone().rotateY(Math.PI));
    }
  }
  const neckY = ionic ? 2.865 : 2.765;
  const bandInner = ionic ? .194 : .19, bandOuter = ionic ? .198 : .195;
  const neckBand = createRomanColumnMoulding([[bandInner, neckY], [bandOuter, neckY],
    [bandOuter, neckY + .018], [bandInner, neckY + .018]], detail);
  parts.forEach(part => colourRomanStone(part));
  // Restrained ochre traces sit on the incised neck band; the shaft stays natural stone.
  colourRomanStone(neckBand, [.87, .72, .43]); parts.push(neckBand);
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  if (!geometry) throw new Error("Roman column geometry could not be combined");
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** One material/mesh per column supports the existing decoration instancing path at every detail tier. */
export const createRomanColumnDecoration = (order: RomanColumnOrder, detailed: boolean,
  finish: RoadDecorationStoneFamily = "limestone", tier: "near" | "far" = "near") => {
  let detail: RomanColumnDetail = detailed ? "high" : "minimal";
  if (tier === "far") detail = "far";
  const geometry = createRomanColumnGeometry(order, detail);
  const source = new MeshStandardMaterial({ roughness: .85, vertexColors: true });
  const material = createRoadDecorationStoneMaterial(source, detailed && tier === "near", finish);
  source.dispose();
  material.normalScale.set(.65, .65);
  const root = new Group(), mesh = new Mesh(geometry, material);
  mesh.name = order === 1 ? "roman-ionic-column" : "roman-doric-column";
  mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
  root.userData.romanColumn = { detail, finish, order };
  let disposed = false;
  return { root, triangles: geometry.index!.count / 3, dispose: () => {
    if (disposed) return;
    disposed = true; geometry.dispose(); material.dispose(); root.clear();
  } };
};

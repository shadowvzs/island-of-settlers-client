import type { BuildingPart, Point3 } from "./building-recipe";
import { addMayaFret, MAYA_CIVIC_IDS, MAYA_STONE, type MayaBuildingKit } from "./maya-building-kit";
import { addMayaCarvedMotif, mayaOccupationCarving } from "./maya-carved-motifs";
import { addMayaHeadquartersPalace } from "./maya-headquarters-design";
import { mayaRoofPlantStyle, type MayaRoofPlanCut } from "./maya-plant-roof-profile";
import type { NationBody, RoofEnvelope } from "./nation-kit-classify";
import { envelopeCenter, envelopeSize, runBetween } from "./nation-kit-parts";
import { getOccupationRoofHeight } from "./occupation-roof-height";

/** A perforated limestone screen: linked side piers, lintels, recessed openings and carved frets. */
export const addMayaRoofComb = (kit: Pick<MayaBuildingKit, "add" | "detailed">,
  centre: Point3, width: number, height: number, depth: number, motif: "mask" | "slotted" | "stepped" = "mask") => {
  const { add, detailed } = kit;
  const cells = detailed ? Math.max(3, Math.round(width / .23)) : 3;
  const foot = .08, cap = .08, pier = Math.min(.065, width / cells * .25);
  add({ position: [centre[0], centre[1] + foot / 2, centre[2]], shape: "bevel-box",
    size: [width, foot, depth + .06], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  add({ position: [centre[0], centre[1] + height * .24, centre[2]], shape: "bevel-box",
    size: [width * .92, height * .4, depth * .94], stage: 4, surface: "plaster" });
  add({ position: [centre[0], centre[1] + height - cap / 2, centre[2]], shape: "bevel-box",
    size: [width * .92, cap, depth], stage: 4, surface: "cut-stone", tint: MAYA_STONE });
  for (let index = 0; index <= cells; index++) {
    const x = centre[0] - width * .46 + width * .92 * index / cells;
    add({ position: [x, centre[1] + height / 2, centre[2]], shape: "bevel-box",
      size: [pier, height - .06, depth], stage: 4, surface: "cut-stone", tint: MAYA_STONE });
    if (index === cells || !detailed) continue;
    addMayaFret(add, [x + width * .46 / cells, centre[1] + height * .34, centre[2] + depth / 2 - .01],
      width * .68 / cells, height * .4, .035, 0, true);
  }
  for (const side of [-1, 1]) add({ position: [centre[0] + side * width * .43,
    centre[1] + height + .055, centre[2]], shape: "bevel-box", size: [.12, .11, depth * .85],
    stage: 4, surface: "cut-stone", tint: MAYA_STONE });
  for (let step = 0; step < (motif === "slotted" ? 0 : 3); step++) add({ position: [centre[0],
    centre[1] + height + .045 + step * .065, centre[2]], shape: "bevel-box",
    size: [width * (.44 - step * .1), .085, depth * .88], stage: 4,
    surface: "cut-stone", tint: MAYA_STONE });
  if (motif !== "mask") return;
  // The lower screen carries a dimensional geometric architectural mask, not a wall painting.
  const faceZ = centre[2] + depth / 2, maskWidth = Math.min(.55, width * .4);
  const maskY = centre[1] + height * .24;
  add({ position: [centre[0], maskY, faceZ + .025], shape: "bevel-box",
    size: [maskWidth, height * .3, .065], stage: 4, surface: "cut-stone", tint: MAYA_STONE });
  for (const side of [-1, 1]) {
    add({ position: [centre[0] + side * maskWidth * .23, maskY + height * .035, faceZ + .06],
      shape: "box", size: [maskWidth * .21, height * .04, .012], stage: 4,
      surface: "stone", tint: [.35, .34, .28] });
    add({ position: [centre[0] + side * maskWidth * .24, maskY + height * .075, faceZ + .067],
      rotation: [0, 0, side * .13], shape: "bevel-box", size: [maskWidth * .3, height * .055, .045],
      stage: 4, surface: "cut-stone", tint: MAYA_STONE });
  }
  add({ position: [centre[0], maskY + height * .005, faceZ + .083], shape: "bevel-box",
    size: [maskWidth * .14, height * .13, .09], stage: 4, surface: "cut-stone", tint: MAYA_STONE });
  add({ position: [centre[0], maskY - height * .085, faceZ + .062], shape: "box",
    size: [maskWidth * .48, height * .045, .015], stage: 4,
    surface: "stone", tint: [.42, .4, .32] });
};

const addCivicRoof = (kit: MayaBuildingKit, roof: RoofEnvelope, main: boolean) => {
  const { add, definition, detailed } = kit, { depth, width } = envelopeSize(roof), centre = envelopeCenter(roof);
  const slabWidth = width - .025, slabDepth = depth - .025;
  add({ position: [centre[0], centre[1] + .045, centre[2]], shape: "bevel-box",
    size: [slabWidth, .09, slabDepth], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  for (const side of [-1, 1]) {
    add({ position: [centre[0], centre[1] + .14, centre[2] + side * (slabDepth / 2 - .035)],
      shape: "box", size: [slabWidth, .13, .07], stage: 3, surface: "plaster" });
    add({ position: [centre[0] + side * (slabWidth / 2 - .035), centre[1] + .14, centre[2]],
      shape: "box", size: [.07, .13, slabDepth], stage: 3, surface: "plaster" });
  }
  if (!main || width < .65 || depth < .45 || definition.style === "tower" && definition.id !== 14) return;
  if (definition.id === 0) {
    const palace = addMayaHeadquartersPalace(kit, centre, width, depth);
    addMayaRoofComb({ add, detailed }, palace.centre, palace.width,
      .65, Math.min(.17, depth * .18), "mask");
  } else {
    // Working civic buildings carry low carved parapets instead of miniature temple crests.
    const panelWidth = Math.min(width * .64, 1.05), panelHeight = definition.id === 34 ? .32 : .24;
    const face = centre[2] + slabDepth / 2 - .025;
    add({ position: [centre[0], centre[1] + .13 + panelHeight / 2, face - .025],
      shape: "box", size: [panelWidth, panelHeight, .07], stage: 3, surface: "plaster" });
    addMayaCarvedMotif(add, mayaOccupationCarving(definition.id),
      [centre[0], centre[1] + .13 + panelHeight / 2, face + .016], panelWidth * .8,
      panelHeight * .75, .028, 0, detailed);
  }
};

interface RoofTowerBody { maxY: number; minY: number; radius: number; x: number; z: number }

/** Tall round masonry bodies retained from the original plan, in building coordinates. */
const roofTowerBodies = (body: NationBody) => {
  const groups = new Map<string, RoofTowerBody>();
  // Detailed round drums are classified as arch surround; the simple LOD keeps a plain ring.
  for (const part of [...body.keep, ...body.doorSurround]) {
    if (part.stock || !["stone-arc", "ring", "cylinder"].includes(part.shape) ||
      !["stone", "plaster", "cut-stone"].includes(part.surface)) continue;
    const key = `${part.position[0].toFixed(2)}/${part.position[2].toFixed(2)}`;
    const group = groups.get(key) ?? { maxY: -Infinity, minY: Infinity, radius: Infinity,
      x: part.position[0], z: part.position[2] };
    group.maxY = Math.max(group.maxY, part.position[1] + part.size[1] / 2);
    group.minY = Math.min(group.minY, part.position[1] - part.size[1] / 2);
    // Gallery and roof-course rings overhang the masonry drum; only upright wall blocks size it.
    // The narrowest course sets the clearance so a tapered drum never reaches the thatch.
    if (part.size[1] >= .12) {
      const taper = Math.min(part.topScale?.[0] ?? 1, part.topScale?.[2] ?? 1);
      group.radius = Math.min(group.radius, Math.max(part.size[0], part.size[2]) / 2 * taper);
    }
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.radius > .25 && group.maxY - group.minY > .8);
};

/** A round lighthouse body pierces the rectangular hall roof: keep loose thatch off its drum. */
const thatchPlanCuts = (body: NationBody, roof: RoofEnvelope): readonly MayaRoofPlanCut[] => {
  if (roof.round) return [];
  const { depth, width } = envelopeSize(roof), centre = envelopeCenter(roof);
  const turned = width > depth, across = turned ? depth : width, along = turned ? width : depth;
  return roofTowerBodies(body)
    .filter(tower => Math.abs(tower.x - centre[0]) < along / 2 &&
      Math.abs(tower.z - centre[2]) < across / 2)
    .map(tower => {
      // Keep the loose thatch clear of the drum, not just outside its wall: the shell and the
      // ridge rope need room for their thickness/frayed ends. The stone collar covers the gap.
      const radius = tower.radius + .12;
      return turned
        ? { radiusX: radius / across, radiusZ: radius / along,
            x: -(tower.z - centre[2]) / across, z: (tower.x - centre[0]) / along }
        : { radiusX: radius / across, radiusZ: radius / along,
            x: (tower.x - centre[0]) / across, z: (tower.z - centre[2]) / along };
    });
};

const addThatchRoof = (kit: MayaBuildingKit, roof: RoofEnvelope) => {
  const { add, definition } = kit, { depth, width } = envelopeSize(roof), centre = envelopeCenter(roof);
  const turned = width > depth, across = turned ? depth : width, along = turned ? width : depth;
  const rise = Math.min(1.15, Math.max(.32, across * .55));
  const profile: BuildingPart["occupationRoof"] = [18, 28].includes(definition.id) ? "half-hip" : "hip";
  const y = centre[1] + rise * .44, plantRoofStyle = mayaRoofPlantStyle(definition.id);
  const roofPlanCuts = thatchPlanCuts(kit.body, roof);
  let surface: BuildingPart["surface"] = "straw";
  if (plantRoofStyle === "palm") surface = "palm-thatch";
  if (plantRoofStyle === "reed") surface = "roof-thatch";
  add({ occupationRoof: profile, plantRoofStyle, position: [centre[0], y, centre[2]],
    roofPlanCuts: roofPlanCuts.length ? roofPlanCuts : undefined,
    rotation: turned ? [0, Math.PI / 2, 0] : undefined, shape: "occupation-roof",
    size: [across, rise, along], stage: 3, surface });
  // The opaque weather core closes hip roofs at every eave. Only a raised half-hip end needs
  // the recessed end panel; a hip panel is a redundant full-roof sheet behind the loose fringe.
  if (profile === "half-hip")
    // Recess both profile sampling and physical end planes so their tops enter the thick shell.
    add({ occupationRoof: profile, plantRoofStyle, position: [centre[0], y - .001, centre[2]],
      roofInfillRatio: [.90, .90], rotation: turned ? [0, Math.PI / 2, 0] : undefined,
      shape: "roof-infill", size: [across * .90, rise, along * .90], stage: 2, surface });
  const point = (u: number, v: number, lift = 0): Point3 => {
    const height = y + getOccupationRoofHeight(profile, u, v) * rise + lift;
    if (turned) return [centre[0] + v * along, height, centre[2] - u * across];
    return [centre[0] + u * across, height, centre[2] + v * along];
  };
  // A Maya stone flashing collar covers the thatch shell where it meets a round drum. The cut
  // alone leaves a small projected bundle on the tower face; the collar hides it without moving
  // the roof, the drum or the silhouette.
  for (const cut of roofPlanCuts) {
    const [cutWorldX, cutWorldY, cutWorldZ] = point(cut.x, cut.z, .012);
    const towerRadius = Math.max(cut.radiusX * across, cut.radiusZ * along);
    const outerRadius = towerRadius + .065, outerDiameter = outerRadius * 2;
    add({ innerRadius: (towerRadius + .006) / outerDiameter,
      position: [cutWorldX, cutWorldY - .02, cutWorldZ],
      radialSegments: kit.detailed ? 24 : 12, shape: "ring", size: [outerDiameter, .18, outerDiameter],
      stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  }

  // The ridge rope must stop at a tower drum instead of continuing through its wall.
  const ropeRuns: Array<[number, number]> = [];
  const blockedAlongRidge = (u: number) => roofPlanCuts.flatMap(cut => {
    const dx = (u - cut.x) / cut.radiusX, reach = 1 - dx * dx;
    if (reach <= 0) return [];
    const half = cut.radiusZ * Math.sqrt(reach);
    return [[cut.z - half - .055, cut.z + half + .055] as [number, number]];
  });
  const blocked = blockedAlongRidge(0);
  let runStart = -.29;
  for (const [from, to] of blocked.sort((a, b) => a[0] - b[0])) {
    if (to <= runStart) continue;
    if (from > runStart) ropeRuns.push([runStart, Math.min(from, .29)]);
    runStart = Math.max(runStart, to);
  }
  if (runStart < .29) ropeRuns.push([runStart, .29]);
  for (const [from, to] of ropeRuns) if (to - from > .01)
    runBetween(add, point(0, from, .025), point(0, to, .025), [.08, .075],
      { roofSupport: true, stage: 3, surface: "rope" });
};

export const addMayaRoofs = (kit: MayaBuildingKit) => {
  const area = (roof: RoofEnvelope) => (roof.max[0] - roof.min[0]) * (roof.max[2] - roof.min[2]);
  const main = kit.body.roofs.reduce<RoofEnvelope | undefined>((best, roof) =>
    !best || area(roof) > area(best) ? roof : best, undefined);
  for (const roof of kit.body.roofs) {
    if (MAYA_CIVIC_IDS.has(kit.definition.id)) addCivicRoof(kit, roof, roof === main);
    else addThatchRoof(kit, roof);
  }
};

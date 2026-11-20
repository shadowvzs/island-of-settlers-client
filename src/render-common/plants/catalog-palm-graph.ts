import type { RoadPlantId } from "../../../../island-of-settlers-shared/src/road-plant-catalog";
import {
  botanicalAdd, botanicalDetail, type BotanicalGraph, botanicalMix, botanicalNoise,
  type BotanicalPoint, botanicalPolar, botanicalRoots, botanicalTube, createBotanicalGraph
} from "./catalog-orchard-graph";
import { createDateFruitCluster } from "./date-fruit-cluster";

const palmTrunk = (graph: BotanicalGraph, species: RoadPlantId, variant: number) => {
  const coconut = species === "dwarf-coconut", fan = species === "fan-palm";
  let crownInset = .43;
  if (coconut) crownInset = .48;
  if (fan) crownInset = .55;
  const crown = graph.height - crownInset;
  const direction = .48 + variant * 1.6, bend = (coconut ? .13 : .045) * (1 + variant * .18);
  const path: BotanicalPoint[] = [];
  for (let ring = 0; ring < 19; ring++) {
    const t = ring / 18;
    path.push(botanicalPolar(direction + Math.sin(t * 4.2) * .045,
      Math.sin(t * 1.6) * bend, crown * t + .008));
  }
  botanicalTube(graph, path, coconut ? .074 : .108, coconut ? .048 : .084, false, true);
  botanicalRoots(graph, variant, coconut ? .074 : .102);
  const centre = path.at(-1)!;
  botanicalTube(graph, [botanicalAdd(centre, [0, -.12, 0]), botanicalAdd(centre, [0, .13, 0])],
    coconut ? .078 : .116, .052, true);
  return centre;
};

/** Anchors the separate date-bunch models around the crown; the palm graph owns no date fruit itself. */
const dateFruitAttachments = (graph: BotanicalGraph, centre: BotanicalPoint, variant: number, detail: number) => {
  const bunches = botanicalDetail(detail, 6, 5, 0);
  for (let bunch = 0; bunch < bunches; bunch++) {
    const angle = bunch * 2.399 + variant;
    const anchor = botanicalAdd(centre, botanicalPolar(angle, .085, -.035));
    graph.attachments.push({
      anchor,
      yaw: Math.atan2(Math.sin(-angle), Math.cos(-angle)),
      graph: createDateFruitCluster(variant, bunch, detail)
    });
  }
};

const coconutBunches = (graph: BotanicalGraph, centre: BotanicalPoint, variant: number, detail: number) => {
  const bunches = botanicalDetail(detail, 3, 3, 2);
  for (let bunch = 0; bunch < bunches; bunch++) {
    const angle = bunch * 2.399 + variant;
    const shoulder = botanicalAdd(centre, botanicalPolar(angle, .105, -.035));
    const end = botanicalAdd(centre, botanicalPolar(angle + .15, .16, -.13));
    botanicalTube(graph, [centre, shoulder, end], .014, .005, true);
    const count = detail === 2 ? 2 : 1;
    for (let fruit = 0; fruit < count; fruit++) {
      const attach = botanicalMix(shoulder, end, .35 + fruit * .45);
      const position = botanicalAdd(attach, botanicalPolar(fruit * 2.399, .035, -.018));
      botanicalTube(graph, [attach, position], .0035, .0025, true);
      graph.fruits.push({ centre: position, radius: [.055, .068, .055], colour: [.45, .47, .17] });
    }
  }
};

const pinnateFrond = (graph: BotanicalGraph, centre: BotanicalPoint, angle: number,
  index: number, species: RoadPlantId, detail: number) => {
  // Crown attachment, arching rachis and drooping terminal form one continuous supported path.
  const coconut = species === "dwarf-coconut", date = species === "date-palm";
  const upright = index % (coconut ? 7 : 5) === 0;
  const spread = graph.radius * (.60 + botanicalNoise(index * 11) * .18) * (upright ? .44 : 1);
  const rise = (index % 3 === 0 ? .38 : .24) * (coconut ? 1 : .88) * (upright ? 1.65 : 1);
  const droop = coconut ? .29 : .17;
  const path: BotanicalPoint[] = [];
  for (let step = 0; step <= 8; step++) {
    const t = step / 8;
    const local = botanicalPolar(angle + Math.sin(t * Math.PI) * .12, spread * t,
      Math.sin(t * Math.PI * .85) * rise - t * t * droop);
    path.push(botanicalAdd(centre, local));
  }
  botanicalTube(graph, path, coconut ? .018 : .022, .0035, true);
  const pairs = botanicalDetail(detail, date ? 19 : 21, date ? 11 : 12, 7);
  for (let pair = 0; pair < pairs; pair++) {
    const t = .16 + pair / pairs * .81;
    const segment = t * 8, lower = Math.floor(segment);
    const anchor = botanicalMix(path[lower]!, path[Math.min(8, lower + 1)]!, segment - lower);
    const length = (coconut ? .30 : .255) * Math.sin(t * Math.PI) ** .55 + .035;
    for (const side of [-1, 1]) {
      const direction = angle + side * (date ? 1.16 : 1.04) - t * side * .22;
      const end = botanicalAdd(anchor, botanicalPolar(direction, length, -.024 - t * .048));
      const joint = botanicalMix(anchor, end, .06);
      if (detail === 2) botanicalTube(graph, [anchor, joint], .0035, .0025, true);
      graph.blades.push({ start: detail === 2 ? joint : anchor, end, width: coconut ? .032 : .028,
        twist: angle + side * .8, shade: .81 + botanicalNoise(index + pair) * .26 });
    }
  }
};

const fanFronds = (graph: BotanicalGraph, centre: BotanicalPoint, variant: number, detail: number) => {
  const count = botanicalDetail(detail, 9, 8, 5);
  for (let index = 0; index < count; index++) {
    const age = count > 1 ? index / (count - 1) : .5;
    const angle = index * 2.399 + variant * .9;
    const base = botanicalAdd(centre, [0, -.03 - age * .26, 0]);
    const petiole = graph.radius * (.42 + botanicalNoise(index + variant) * .12) * (1 - age * .08);
    const lift = .06 + (1 - age) * .22 + botanicalNoise(index * 5 + variant) * .06;
    const start = botanicalAdd(base, botanicalPolar(angle, petiole, lift));
    botanicalTube(graph, [base, botanicalAdd(base, botanicalPolar(angle, petiole * .58, lift * .62)), start],
      .021, .012, true);
    const elevation = 1.02 + (1 - age) * .34 + botanicalNoise(index * 3 + variant) * .05;
    const radius = graph.radius * (.32 + botanicalNoise(index * 4) * .08) * (1 - age * .07);
    const costa = .18 + botanicalNoise(index * 9 + variant) * .07;
    const axis = botanicalPolar(angle, Math.cos(elevation), Math.sin(elevation));
    botanicalTube(graph, [start, botanicalAdd(start, [
      axis[0] * radius * costa, axis[1] * radius * costa, axis[2] * radius * costa])], .006, .003, true);
    graph.fans.push({ start, direction: angle, elevation, radius,
      rise: .012 + botanicalNoise(index + variant * 7) * .018, costa,
      shade: .82 + botanicalNoise(index) * .23 });
  }
};

/** True pinnate Phoenix/Cocos leaves and a separately authored costapalmate fan architecture. */
export const createCatalogPalmGraph = (species: RoadPlantId, variant: number, detail: number,
  standalone = false): BotanicalGraph => {
  const graph = createBotanicalGraph(species);
  if (standalone) {
    graph.radius = 1.45;
    if (species === "fan-palm") graph.radius = 1.35;
    if (species === "dwarf-coconut") graph.radius = 1.55;
  }
  const centre = palmTrunk(graph, species, variant);
  if (species === "fan-palm") {
    fanFronds(graph, centre, variant, detail);
    return graph;
  }
  const fronds = species === "dwarf-coconut" ? 11 : 15;
  for (let frond = 0; frond < fronds; frond++)
    pinnateFrond(graph, centre, frond * 2.399 + variant * 1.1, frond + variant * 17, species, detail);
  if (detail > 0) {
    if (species === "date-palm") dateFruitAttachments(graph, centre, variant, detail);
    else coconutBunches(graph, centre, variant, detail);
  }
  return graph;
};

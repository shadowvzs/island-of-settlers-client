import {
  botanicalAdd, botanicalDetail, type BotanicalGraph, botanicalMix, botanicalNoise,
  type BotanicalPoint, botanicalTube, createBotanicalGraph
} from "./catalog-orchard-graph";

/**
 * A single date bunch is a separate, attachable model. Its local origin is the point where the
 * bunch hangs from the palm crown; local +X points away from the trunk. A palm therefore owns
 * only the anchors, while each bunch can be added, removed, varied or harvested independently.
 */
export const createDateFruitCluster = (variant: number, bunch: number, detail: number): BotanicalGraph => {
  const graph = createBotanicalGraph("date-palm");
  graph.height = .5;
  graph.radius = .38;
  // High keeps 8-triangle dates under the fixed 14,360-triangle palm ceiling; Minimal's
  // 6-triangle beads fit its 3,848 ceiling with four full strands per bunch.
  const strands = botanicalDetail(detail, 6, 4, 3);
  const perStrand = botanicalDetail(detail, 8, 5, 4);
  const stalkEnd: BotanicalPoint = [
    .13 + botanicalNoise(bunch + variant) * .045,
    -.10 - botanicalNoise(bunch * 3 + variant) * .05,
    (botanicalNoise(bunch * 5 + variant) - .5) * .035
  ];
  // The stalk is straw-orange wood, not foliage: it keeps its own tint inside the bunch mesh.
  botanicalTube(graph, [[0, 0, 0], botanicalMix([0, 0, 0], stalkEnd, .55), stalkEnd],
    .016, .006, false, false, false, [.753, .541, .227]);
  for (let strand = 0; strand < strands; strand++) {
    const spread = (strand - (strands - 1) / 2) * .48 +
      (botanicalNoise(strand + bunch * 7 + variant) - .5) * .12;
    const length = .18 + botanicalNoise(strand + bunch * 9 + variant) * .065;
    const tip = botanicalAdd(stalkEnd, [
      Math.cos(spread) * length * .62 + .045,
      -.17 - botanicalNoise(strand * 2 + bunch + variant) * .075,
      Math.sin(spread) * length
    ]);
    botanicalTube(graph, [stalkEnd, botanicalMix(stalkEnd, tip, .55), tip], .0048, .002, true);
    for (let fruit = 0; fruit < perStrand; fruit++) {
      const along = .10 + fruit / perStrand * .86;
      const attach = botanicalMix(stalkEnd, tip, along);
      // Two staggered sides make the bunch read as a packed mass rather than a flat fan.
      const side = spread + Math.PI / 2;
      const row = fruit % 2 === 0 ? 1 : -1;
      const sideOffset = row * (.010 + botanicalNoise(fruit + strand * 5 + bunch * 11 + variant) * .005);
      const position = botanicalAdd(attach, [
        Math.cos(side) * sideOffset,
        -.008 - (fruit % 3) * .004,
        Math.sin(side) * sideOffset
      ]);
      const ripeness = Math.min(1, .02 + bunch * .025 + strand * .018 + fruit / perStrand * .55 +
        botanicalNoise(fruit * 3 + bunch + variant) * .12);
      graph.fruits.push({
        centre: position,
        kind: "date",
        radius: [.017, .024, .017],
        colour: dateTone(ripeness, fruit + strand * 7 + bunch + variant)
      });
    }
  }
  return graph;
};

const dateTone = (ripeness: number, seed: number): BotanicalPoint => {
  const green: BotanicalPoint = [.32, .43, .15], gold: BotanicalPoint = [.86, .61, .14];
  const amber: BotanicalPoint = [.70, .33, .075], dark: BotanicalPoint = [.36, .16, .045];
  const tint = 1 + (botanicalNoise(seed) - .5) * .10;
  const tinted = (colour: BotanicalPoint) => colour.map(value => value * tint) as BotanicalPoint;
  if (ripeness < .14) return tinted(green);
  if (ripeness < .38) return tinted(botanicalMix(green, gold, (ripeness - .14) / .24));
  if (ripeness < .74) return tinted(botanicalMix(gold, amber, (ripeness - .38) / .36));
  return tinted(botanicalMix(amber, dark, (ripeness - .74) / .26));
};

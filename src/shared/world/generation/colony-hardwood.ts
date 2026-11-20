import { MARBLE_DEPOSIT_QUANTITY } from "../../balance/resources";
import { colonyResourcePair } from "../colony-resource-tiers";
import { sampleSmooth } from "../grid-geometry";
import { createRandom, deriveSeed } from "../rng";
import { COMPETITION, CONIFER, encodeTreeForm, HARDWOOD, HARDWOOD_SOURCE } from "../tree-forms";
import { PROP, type WorldData } from "../world-data";
import { createWalkCost } from "./walkability";

/** Fresh colony resource pass: preserve positions, indices and terrain; replace every ordinary tree. */
export const populateColonyHardwood = (world: WorldData) => {
  if (world.expeditionKind !== "colony" || world.colonyResourceTier === undefined) return 0;
  const pair = colonyResourcePair(world.colonyResourceTier);
  const trees = new Set<number>([PROP.broadleafTree, PROP.birchTree, PROP.coniferTree, PROP.palmTree,
    PROP.hardwoodTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree]);
  const random = createRandom(deriveSeed(world.seed, "colony-selected-wood-v1"));
  let forms: readonly number[] = Object.values(HARDWOOD_SOURCE);
  if (pair.treeKind === PROP.cedarTree) forms = Object.values(CONIFER);
  if (pair.treeKind === PROP.hardwoodTree) forms = Object.values(HARDWOOD);
  let count = 0;
  for (let id = 0; id < world.props.count; id++) {
    if (!trees.has(world.props.types[id]!)) continue;
    world.props.types[id] = pair.treeKind;
    world.props.form[id] = encodeTreeForm(forms[count % forms.length]!, COMPETITION.open);
    world.props.scale[id] = 1.12 + random() * .2;
    count++;
  }
  // Existing surface boulders become specialist sources, never hidden ordinary-stone targets.
  // Scenic rock geometry remains intact; only these finite source IDs are harvested.
  const stones: number[] = [];
  for (let id = 0; id < world.props.count; id++) {
    if (world.props.types[id] !== PROP.largeRock) continue;
    const x = world.props.x[id]!, z = world.props.z[id]!;
    if (x < 1 || z < 1 || x >= world.cellsX - 1 || z >= world.cellsZ - 1 ||
      sampleSmooth(world, world.heights, x, z) <= world.seaLevel + .1) continue;
    stones.push(id);
  }
  world.colonyStoneDeposits = stones.slice(0, 3).map((sourceProp, id) => ({ id, sourceProp,
    material: pair.stone, remaining: MARBLE_DEPOSIT_QUANTITY,
    x: world.props.x[sourceProp]!, z: world.props.z[sourceProp]! }));
  if (count) world.walkCost = createWalkCost(world, world.slopeClass, world.blocking, world.splat, world.props);
  return count;
};

import { COVER } from "../render-common/props/prop-meshes";
import { sampleSmooth } from "../shared/world/grid-geometry";
import { PROP, type WorldData } from "../shared/world/world-data";

/** Every plant kind in garden rows: wetland, forest, field (world props and field cover). */
const GARDEN_ROWS: number[][] = [
  [PROP.cattail, PROP.reeds, PROP.sedge, PROP.riverShrub, PROP.willowShrub],
  [PROP.bush, PROP.berryBush, PROP.fern, PROP.sapling, PROP.broadleafShrub],
  [PROP.fieldShrub, PROP.flowers, COVER.shortGrass, COVER.tallGrass, COVER.dryTuft],
  [COVER.seedGrass, COVER.clover, COVER.fieldWeed, COVER.yellowFlower, COVER.whiteFlower],
  [COVER.pinkFlower, COVER.thistle]
];
/** Two tree lines behind the plant rows (seasons review): deciduous and evergreen side by side. */
const GARDEN_TREES: number[] = [
  PROP.broadleafTree, PROP.birchTree, PROP.walnutTree, PROP.hardwoodTree,
  PROP.mahoganyTree, PROP.coniferTree, PROP.cedarTree, PROP.palmTree
];
const COPIES = 3;
const SPACING = 1.5;
const TREE_SPACING = 2.8;
const TREE_LINES = [-6.5, -10.5];
const CLEAR_RADIUS = 17;

interface GardenPlant {
  type: number;
  x: number;
  z: number;
}

/** Rows run along the screen horizontal of the iso view (x up, z down), rows one behind another. */
const layoutGarden = (centreX: number, centreZ: number) => {
  const plants: GardenPlant[] = [];
  GARDEN_ROWS.forEach((row, rowIndex) => {
    row.forEach((type, column) => {
      for (let copy = 0; copy < COPIES; copy += 1) {
        const along = (column * COPIES + copy - 7) * SPACING * 0.42;
        const across = (rowIndex - 2) * SPACING;
        plants.push({ type, x: centreX + along + across, z: centreZ - along + across });
      }
    });
  });
  TREE_LINES.forEach((across, line) => {
    GARDEN_TREES.forEach((type, column) => {
      const along = (column - (GARDEN_TREES.length - 1) / 2) * TREE_SPACING + line * TREE_SPACING * 0.5;
      plants.push({ type, x: centreX + along + across, z: centreZ - along + across });
    });
  });
  return plants;
};

/**
 * Lab view (?garden=1): replaces the props around the start with rows of every plant kind
 * (three copies, so variants mix) in the meadow, for close inspection.
 */
export const plantGarden = (world: WorldData) => {
  const { x: centreX, z: centreZ } = world.start;
  const { props } = world;
  const kept: number[] = [];
  for (let index = 0; index < props.count; index += 1) {
    const far = Math.hypot(props.x[index]! - centreX, props.z[index]! - centreZ) > CLEAR_RADIUS;
    if (far) kept.push(index);
  }
  const garden = layoutGarden(centreX, centreZ);
  const count = kept.length + garden.length;
  const pick = <T extends Float32Array | Uint8Array>(
    source: T,
    extra: (plant: GardenPlant) => number
  ) => {
    const target = new (source.constructor as new (length: number) => T)(count);
    kept.forEach((index, slot) => (target[slot] = source[index]!));
    garden.forEach((plant, slot) => (target[kept.length + slot] = extra(plant)));
    return target;
  };
  world.props = {
    count,
    form: pick(props.form, () => 0),
    phase: pick(props.phase, (plant) => plant.x * 1.7),
    rotation: pick(props.rotation, (plant) => (plant.x * 2.3) % (Math.PI * 2)),
    scale: pick(props.scale, () => 1),
    types: pick(props.types, (plant) => plant.type),
    x: pick(props.x, (plant) => plant.x),
    y: pick(props.y, (plant) => sampleSmooth(world, world.heights, plant.x, plant.z)),
    z: pick(props.z, (plant) => plant.z)
  };
};

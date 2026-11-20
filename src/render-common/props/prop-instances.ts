import { sampleBilinear, sampleSmooth } from "../../shared/world/grid-geometry";
import { PROP, PROP_REMOVED, type WorldData } from "../../shared/world/world-data";
import { ADVENTURE_PROP } from "./adventure-prop-kinds";
import { getTreeInstanceScale, getTreeSpecies, getTreeVariant } from "./island-trees";
import { getMeshId, getVariantCount } from "./prop-mesh-layout";

/** Per instance data of the world props (struct of arrays, sorted far to near). */
export interface PropInstances {
  count: number;
  fog: Float32Array;
  meshIds: Uint16Array;
  phase: Float32Array;
  rotation: Float32Array;
  scale: Float32Array;
  /** Index in world.props (picking, felling); -1 for render only props such as grass. */
  sourceIndex: Int32Array;
  /** Height multiplier on top of the scale (plants vary height and width independently). */
  stretch: Float32Array;
  sunVisibility: Float32Array;
  /**
   * Optional ground tilt (x and z of the unit terrain normal per instance; y follows): instances
   * lying on the ground (shore shells) align to the slope. Absent: upright instances.
   */
  tilt?: Float32Array;
  /** rgb multiplier per instance (grass takes the colour of the ground). */
  tint: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export interface RawInstance {
  meshId: number;
  phase: number;
  rotation: number;
  scale: number;
  sourceIndex: number;
  stretch: number;
  /** Terrain normal x and z (see PropInstances.tilt). */
  tilt?: readonly [number, number];
  tint: [number, number, number];
  x: number;
  y: number;
  z: number;
}

/** Zero-filled instance arrays for `count` instances (0: an empty layer). */
export const allocatePropInstances = (count: number): PropInstances => ({
  count,
  fog: new Float32Array(count),
  meshIds: new Uint16Array(count),
  phase: new Float32Array(count),
  rotation: new Float32Array(count),
  scale: new Float32Array(count),
  sourceIndex: new Int32Array(count),
  stretch: new Float32Array(count),
  sunVisibility: new Float32Array(count),
  tint: new Float32Array(count * 3),
  x: new Float32Array(count),
  y: new Float32Array(count),
  z: new Float32Array(count)
});

/** Struct of arrays sorted by x + z: far to near for the shared iso camera. */
export const toInstances = (
  world: WorldData,
  fog: Float32Array,
  raw: RawInstance[]
): PropInstances => {
  raw.sort((a, b) => a.x + a.z - (b.x + b.z));
  const instances = allocatePropInstances(raw.length);
  if (raw.some((item) => item.tilt)) instances.tilt = new Float32Array(raw.length * 2);
  raw.forEach((item, index) => {
    instances.meshIds[index] = item.meshId;
    instances.x[index] = item.x;
    instances.y[index] = item.y;
    instances.z[index] = item.z;
    instances.scale[index] = item.scale;
    instances.rotation[index] = item.rotation;
    instances.phase[index] = item.phase;
    instances.sourceIndex[index] = item.sourceIndex;
    instances.stretch[index] = item.stretch;
    instances.tint.set(item.tint, index * 3);
    if (item.tilt) instances.tilt!.set(item.tilt, index * 2);
    instances.sunVisibility[index] = sampleBilinear(world, world.sunShadow, item.x, item.z) / 255;
    instances.fog[index] = sampleBilinear(world, fog, item.x, item.z);
  });
  return instances;
};

/** Stable pseudo random 0..1 per instance index and purpose. */
const hashIndex = (index: number, salt: number) =>
  (Math.imul(index + 1, 2654435761) ^ Math.imul(salt, 40503)) >>> 0;

/** Variant from the instance index (stable, spread evenly). */
const pickVariant = (kind: number, index: number) => hashIndex(index, 0) % getVariantCount(kind);

const unit = (index: number, salt: number) => (hashIndex(index, salt) % 10_000) / 10_000;

const PLANT_KINDS = new Set<number>([
  PROP.bush,
  PROP.flowers,
  PROP.reeds,
  PROP.cattail,
  PROP.riverShrub,
  PROP.willowShrub,
  PROP.sedge,
  PROP.berryBush,
  PROP.fern,
  PROP.sapling,
  PROP.broadleafShrub,
  PROP.fieldShrub,
  PROP.waterLily
]);

/** Floating water lilies keep their authored water-surface anchor. */
const isGroundedPlant = (type: number) => PLANT_KINDS.has(type) && type !== PROP.waterLily;

/** Bury the spread of the roots slightly, including their downhill side. */
export const getPlantGroundHeight = (world: WorldData, x: number, z: number, scale: number) => {
  const radius = .06 * scale;
  let height = sampleSmooth(world, world.heights, x, z);
  for (const dx of [-radius, 0, radius]) {
    for (const dz of [-radius, 0, radius]) {
      height = Math.min(height, sampleSmooth(world, world.heights, x + dx, z + dz));
    }
  }
  return height - .01;
};

/** Plants vary height (about +-15 %) and hue a little per instance; trees and rocks do not. */
const getPlantVariation = (type: number, index: number) => {
  if (!PLANT_KINDS.has(type)) return { stretch: 1, tint: [1, 1, 1] as [number, number, number] };
  const warm = (unit(index, 2) - 0.5) * 0.08;
  const shade = 0.94 + unit(index, 3) * 0.12;
  return {
    stretch: 0.86 + unit(index, 1) * 0.3,
    tint: [shade * (1 + warm), shade, shade * (1 - warm)] as [number, number, number]
  };
};

/** Shared render anchor: plants bury their roots; floating/wading props retain water anchors. */
export const getPropInstanceHeight = (world: WorldData, index: number) => {
  const { props } = world;
  const type = props.types[index]!;
  const wading = (type === PROP.reeds || type === PROP.cattail) &&
    props.y[index]! > sampleSmooth(world, world.heights, props.x[index]!, props.z[index]!) + .01;
  return isGroundedPlant(type) && !wading
    ? getPlantGroundHeight(world, props.x[index]!, props.z[index]!, props.scale[index]!)
    : props.y[index]!;
};

/**
 * Trees pick their mesh by age and structural form (archetype, competition); other props a
 * stable random variant.
 */
const getPlacement = (type: number, index: number, scale: number, form: number) => {
  if (getTreeSpecies(type) === undefined)
    return { meshId: getMeshId(type, pickVariant(type, index)), scale };
  const variant = getTreeVariant(type, scale, form);
  return { meshId: getMeshId(type, variant), scale: getTreeInstanceScale(type, scale, variant) };
};

/** Instances of the world props `from` .. `to` (exclusive, removed ones left out), far to near. */
/** The standing world prop as a raw instance, or null when it was removed. */
const toRawInstance = (world: WorldData, index: number): RawInstance | null => {
  const { props } = world;
  if (props.types[index] === PROP_REMOVED) return null;
  const type = props.types[index]!;
  if (world.expeditionKind && type === PROP.flowers) return null;
  const placed = getPlacement(type, index, props.scale[index]!, props.form[index]!);
  if (world.expeditionKind && type === PROP.waterLily)
    placed.meshId = getMeshId(PROP.waterLily, pickVariant(PROP.waterLily, index) % 3);
  const theme = world.expeditionTheme ?? world.adventureTheme;
  if (theme === "desert" && type === PROP.fieldShrub)
    placed.meshId = getMeshId(ADVENTURE_PROP.cactus, pickVariant(ADVENTURE_PROP.cactus, index));
  if (theme === "swamp" && (type === PROP.broadleafTree || type === PROP.birchTree)) {
    const kind = type === PROP.broadleafTree ? ADVENTURE_PROP.sparseOak : ADVENTURE_PROP.sparseBirch;
    placed.meshId = getMeshId(kind, getTreeVariant(type, props.scale[index]!, props.form[index]!));
  }
  return {
    ...placed,
    ...getPlantVariation(props.types[index]!, index),
    phase: props.phase[index]!,
    rotation: props.rotation[index]!,
    sourceIndex: index,
    x: props.x[index]!,
    y: getPropInstanceHeight(world, index),
    z: props.z[index]!
  };
};

/** Canonical authored instance transform, shared by physical clearance and rendering. */
export const getPlacedPropInstance = toRawInstance;

export const buildPropInstanceRange = (
  world: WorldData,
  fog: Float32Array,
  from: number,
  to: number,
  /** World props before `from` drawn with the range (map editor: brought back by an undo). */
  extra: readonly number[] = []
) => {
  const raw: RawInstance[] = [];
  const add = (index: number) => {
    const instance = toRawInstance(world, index);
    if (instance) raw.push(instance);
  };
  extra.forEach(add);
  for (let index = from; index < to; index += 1) add(index);
  return toInstances(world, fog, raw);
};

export const buildPropInstances = (world: WorldData, fog: Float32Array) =>
  buildPropInstanceRange(world, fog, 0, world.props.count);

/** Instance index of every world prop (sourceIndex -> index; render only props left out). */
export const createSourceLookup = (instances: PropInstances) => {
  const lookup = new Map<number, number>();
  for (let index = 0; index < instances.count; index += 1) {
    const source = instances.sourceIndex[index]!;
    if (source >= 0) lookup.set(source, index);
  }
  return lookup;
};

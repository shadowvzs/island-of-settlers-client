import type { ExpeditionTheme } from "../../settlement/island-discovery-policy";
import { removePropsAt } from "../editing/prop-removal";
import { createFbm } from "../noise";
import { createRandom, deriveSeed } from "../rng";
import { BIRCH, BROADLEAF, COMPETITION, encodeTreeForm,PALM } from "../tree-forms";
import { MATERIAL, MATERIAL_COUNT, PROP, PROP_REMOVED, type WorldData } from "../world-data";
import { clearAdventureDeposits } from "./adventure-deposits";
import { applyDesertOases, type OasisProtection } from "./desert-oases";
import { createWalkCost } from "./walkability";

const TREES = new Set<number>([PROP.broadleafTree, PROP.birchTree, PROP.coniferTree, PROP.palmTree]);
const SHRUBS = new Set<number>([PROP.bush, PROP.berryBush, PROP.broadleafShrub, PROP.fieldShrub,
  PROP.riverShrub, PROP.willowShrub, PROP.fern, PROP.sapling]);

/** New expedition ecology; colonies keep their forestry stock, and saved map buffers are not rethemed. */
export const applyExpeditionWorldTheme = (world: WorldData, theme: ExpeditionTheme, kind: "adventure" | "colony",
  protection?: OasisProtection) => {
  world.expeditionKind = kind;
  world.expeditionTheme = theme;
  if (kind === "adventure") world.adventureTheme = theme;
  const random = createRandom(deriveSeed(world.seed, `adventure-ecology:${theme}`));
  const removed: number[] = [], { props } = world;
  for (let index = 0; index < props.count; index++) {
    const type = props.types[index]!, roll = random();
    // Retheming an existing colony never turns a saved hardwood resource back into ordinary timber.
    if (type === PROP.hardwoodTree || type === PROP.cedarTree ||
      type === PROP.walnutTree || type === PROP.mahoganyTree) continue;
    if (TREES.has(type)) {
      if (theme === "tropical") {
        props.types[index] = PROP.palmTree;
        let form: number;
        if (roll < .72) form = PALM.coconut;
        else if (roll < .9) form = PALM.fan;
        else if (roll < .96) form = PALM.leaning;
        else form = PALM.ground;
        props.form[index] = encodeTreeForm(form, COMPETITION.open);
        props.scale[index] = .7 + random() * .4;
      } else if (theme === "forest") {
        props.types[index] = roll < .32 ? PROP.birchTree : PROP.broadleafTree;
        props.form[index] = encodeTreeForm(roll < .32 ? BIRCH.classic : BROADLEAF.oak,
          roll < .5 ? COMPETITION.edge : COMPETITION.interior);
      } else if (theme === "desert") {
        // Rare date palms remain at oases; cactus silhouettes are a bounded render-only layer.
        if (kind === "colony") {
          // Oasis trees remain real harvestable timber; cacti only replace decorative shrubs.
          if (type === PROP.palmTree) props.form[index] = encodeTreeForm(PALM.date, COMPETITION.open);
        } else if (type !== PROP.palmTree || roll > .18) {
          props.types[index] = PROP.fieldShrub;
          props.form[index] = 0;
          props.scale[index] = .8 + random() * .6;
        }
        else props.form[index] = encodeTreeForm(PALM.date, COMPETITION.open);
      } else if (theme === "swamp") {
        if (kind === "adventure" && roll > .3) { removed.push(index); continue; }
        props.types[index] = roll < .2 ? PROP.birchTree : PROP.broadleafTree;
        props.form[index] = encodeTreeForm(roll < .2 ? BIRCH.weeping : BROADLEAF.oak, COMPETITION.interior);
        if (kind === "adventure") props.scale[index] = Math.min(props.scale[index]!, .8);
      }
    } else if (theme === "swamp" && SHRUBS.has(type)) {
      if (roll > .45) removed.push(index);
      else props.types[index] = roll < .2 ? PROP.sedge : PROP.willowShrub;
    } else if (theme === "desert" && SHRUBS.has(type)) {
      if (roll > .3) removed.push(index);
      else {
        props.types[index] = PROP.fieldShrub;
        props.form[index] = 0;
        props.scale[index] = .8 + random() * .6;
      }
    }
  }
  if (removed.length) removePropsAt(world, removed);

  const patches = createFbm(deriveSeed(world.seed, "adventure-wetland-patches"), { octaves: 2 });
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    const offset = vertex * MATERIAL_COUNT, height = world.heights[vertex]!;
    if (height <= world.seaLevel + .2 || world.waterDepth[vertex]! > 0) continue;
    if (theme === "tropical") {
      const forest = world.splat[offset + MATERIAL.forestFloor]!;
      const sand = Math.round(forest * .45);
      world.splat[offset + MATERIAL.forestFloor] = 0;
      world.splat[offset + MATERIAL.grass] = Math.min(255, world.splat[offset + MATERIAL.grass]! + forest - sand);
      world.splat[offset + MATERIAL.sand] = Math.min(255, world.splat[offset + MATERIAL.sand]! + sand);
    } else if (theme === "swamp") {
      // Wet ground adds no water or blocking: existing river channels supply the fresh water,
      // and the normal infantry/cavalry dry run still validates every camp after this pass.
      if (world.splat[offset + MATERIAL.sand]! > 128 || world.splat[offset + MATERIAL.rock]! > 100 ||
        world.splat[offset + MATERIAL.mine]! > 80) continue;
      const x = vertex % (world.cellsX + 1), z = Math.floor(vertex / (world.cellsX + 1));
      const wet = world.riverDistance[vertex]! < 7 || (height < 3.2 && patches(x * .08, z * .08) > -.1);
      if (!wet) continue;
      world.splat.fill(0, offset, offset + MATERIAL_COUNT);
      world.splat[offset + MATERIAL.lushGrass] = 90;
      world.splat[offset + MATERIAL.dirt] = 130;
      world.splat[offset + MATERIAL.forestFloor] = 35;
      world.moisture[vertex] = 240;
      world.wetRock[vertex] = Math.max(world.wetRock[vertex]!, 180);
    }
  }
  if (theme === "desert") applyDesertOases(world, protection);
  world.walkCost = createWalkCost(world, world.slopeClass, world.blocking, world.splat, props);
  return world;
};

/** Cosmetic omissions keep all prop indices, RNG streams, terrain and ore buffers stable. */
export const markExpeditionWorld = (world: WorldData, kind: "adventure" | "colony") => {
  // Theme/oasis post-processing is not part of the persisted built-in terrain recipe yet.
  world.generationProvenance = undefined;
  world.expeditionKind = kind;
  if (kind === "adventure") clearAdventureDeposits(world);
  for (let index = 0; index < world.props.count; index++) {
    if (world.props.types[index] === PROP.flowers) world.props.types[index] = PROP_REMOVED;
  }
  return world;
};

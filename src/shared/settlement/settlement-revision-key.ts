import type { SettlementContext } from "./settlement-types";

interface CachedRevision {
  build: number;
  buildings: number;
  navigation: number;
  roads: number;
  terrain: number;
  value: string;
}

const revisions = new WeakMap<SettlementContext, CachedRevision>();

/**
 * The navigation/road/build/terrain revision key shared by movement plans, the executor and
 * corridor reservations. The inputs change rarely, so the string is reused instead of rebuilt for
 * every actor every tick; the value is identical to building it inline.
 */
export const navigationRevisionKey = (context: SettlementContext) => {
  const build = context.options.world.buildRevision ?? 0;
  const buildings = context.buildings.length;
  const navigation = context.navigationRevision ?? 0;
  const roads = context.options.roads.revision ?? 0;
  const terrain = context.options.world.terrainRevision ?? 0;
  const previous = revisions.get(context);
  if (previous && previous.build === build && previous.buildings === buildings &&
    previous.navigation === navigation && previous.roads === roads && previous.terrain === terrain)
    return previous.value;
  const value = `${navigation}/${roads}/${build}/${terrain}/${buildings}`;
  revisions.set(context, { build, buildings, navigation, roads, terrain, value });
  return value;
};

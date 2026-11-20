import { buildingNavigationRevision } from "./settlement-building-navigation";
import type { SettlementContext } from "./settlement-types";

const decorationRevision = (context: SettlementContext) => context.roadDecorations?.revision() ?? 0;

interface RouteRevisionParts {
  build: number;
  buildings: string;
  camps: number;
  decorations: number;
  props: number;
  terrain: number;
  value: string;
}
const routeRevisions = new WeakMap<SettlementContext, RouteRevisionParts>();

/**
 * Changes whenever buildings, trees, rocks or road decorations change: the boundary at which the
 * route caches look again. Equal parts return the very same string, so cache keys compare by identity.
 */
export const routeRevision = (context: SettlementContext) => {
  const { world } = context.options;
  const build = world.buildRevision ?? 0, props = world.props.count, terrain = world.terrainRevision ?? 0;
  const camps = context.adventure?.campRevision?.() ?? 0, buildings = buildingNavigationRevision(context);
  const decorations = decorationRevision(context), previous = routeRevisions.get(context);
  if (previous && previous.build === build && previous.props === props && previous.terrain === terrain &&
    previous.camps === camps && previous.decorations === decorations && previous.buildings === buildings)
    return previous.value;
  const value = `${build}:${props}:${camps}:${terrain}:${buildings}:${decorations}`;
  routeRevisions.set(context, { build, buildings, camps, decorations, props, terrain, value });
  return value;
};

/** Everything that changes reachability except the building stock: empty-route memo key. */
export const connectivityRevision = (context: SettlementContext) => {
  const { world } = context.options;
  return `${world.buildRevision ?? 0}:${world.props.count}:${context.adventure?.campRevision?.() ?? 0}:` +
    `${world.terrainRevision ?? 0}:${context.navigationRevision ?? 0}:${decorationRevision(context)}`;
};

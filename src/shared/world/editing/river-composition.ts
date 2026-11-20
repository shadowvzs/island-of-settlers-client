import { applyGeneratedRiver } from "../generation/generated-river-apply";
import type { WorldData } from "../world-data";
import type { AuthoredRiver } from "./authored-rivers";
import type { GeneratedRiver } from "./generated-river-types";
import { suppressRiverVertex } from "./river-water-suppression";

type River = AuthoredRiver | GeneratedRiver;
export interface RiverLayer {
  generated: boolean;
  river: River;
}
export interface RiverCompositionChange {
  generated: boolean;
  id: number;
  river: River | null;
  reshape?: boolean;
}
const changedParts = function* (river: River) {
  for (const patch of river.patches) for (let part = 0; part < 5; part++)
    if (patch.before[part] !== patch.after[part])
      yield { vertex: patch.vertex, part, before: patch.before[part]!, after: patch.after[part]! };
};
const readPart = (world: WorldData, vertex: number, part: number) => {
  if (part === 0) return world.heights[vertex]!;
  if (part === 1) return world.waterSurface[vertex]!;
  if (part === 2) return world.waterDepth[vertex]!;
  return world.flow[vertex * 2 + part - 3]!;
};
const baseUnchanged = (world: WorldData, river: River) => {
  for (const part of changedParts(river))
    if (readPart(world, part.vertex, part.part) !== part.before) return false;
  return true;
};

const writePart = (world: WorldData, vertex: number, part: number, value: number) => {
  if (part === 0) world.heights[vertex] = value;
  else if (part === 1) world.waterSurface[vertex] = value;
  else if (part === 2) world.waterDepth[vertex] = value;
  else world.flow[vertex * 2 + part - 3] = value;
};

const removeFalls = (world: WorldData, river: River) => {
  for (const own of [...river.falls].reverse()) {
    const index = world.waterfalls.findLastIndex(fall =>
      Object.keys(own).every(key => fall[key as keyof typeof own] === own[key as keyof typeof own]));
    if (index >= 0) world.waterfalls.splice(index, 1);
  }
};

/** Canonical painter order: captured generated channels, then explicitly drawn channels.
 * Reverse the whole stack before replaying dependencies; never edit through a later layer's base.
 * Original patches replay byte-for-byte when their inputs are unchanged. Only dependent layers
 * recarve. Independently painted primary components are reapplied after composition. */
export const composeRiverEdit = (
  world: WorldData,
  change: RiverCompositionChange,
  applyAuthored: (draft: WorldData, river: AuthoredRiver) => void
) => {
  const layers: RiverLayer[] = [
    ...(world.generatedRivers ?? []).map(river => ({ generated: true, river })),
    ...(world.authoredRivers ?? []).map(river => ({ generated: false, river }))
  ];
  const patches = layers.reduce((sum, layer) => sum + layer.river.patches.length, 0);
  if (patches > Math.min(world.heights.length * 4, 262144))
    throw new Error("River composition exceeds the working patch budget. Use smaller channel groups.");
  const draft: WorldData = { ...world, heights: world.heights.slice(),
    waterSurface: world.waterSurface.slice(), waterDepth: world.waterDepth.slice(),
    flow: world.flow.slice(), riverDistance: world.riverDistance.slice(),
    lakeWater: world.lakeWater?.slice(), waterfalls: structuredClone(world.waterfalls) };
  const owners = new Map<number, { vertex: number; part: number; after: number }>();
  for (const layer of layers) for (const part of changedParts(layer.river))
    owners.set(part.vertex * 5 + part.part, part);
  const manual = [...owners.values()].flatMap(part => {
    const actual = readPart(world, part.vertex, part.part);
    return actual === part.after ? [] : [{ ...part, actual }];
  });
  const masks = new Set(layers.flatMap(layer => layer.river.suppressedVertices ?? []));
  const vertices = new Set(layers.flatMap(layer => layer.river.patches.map(patch => patch.vertex)));
  for (const layer of [...layers].reverse()) {
    for (const part of changedParts(layer.river)) {
      const value = readPart(draft, part.vertex, part.part);
      if (value === part.after) writePart(draft, part.vertex, part.part, part.before);
    }
    removeFalls(draft, layer.river);
  }
  const existing = layers.find(layer => layer.generated === change.generated && layer.river.id === change.id);
  const nextLayers = layers.flatMap(layer => {
    if (layer !== existing) return [layer];
    return change.river ? [{ generated: change.generated, river: change.river }] : [];
  });
  if (!existing && change.river) nextLayers.push({ generated: change.generated, river: change.river });
  const generated: GeneratedRiver[] = [], authored: AuthoredRiver[] = [];
  for (const layer of nextLayers) {
    const selected = layer.generated === change.generated && layer.river.id === change.id;
    const river = structuredClone(layer.river);
    const unchangedBase = !selected && baseUnchanged(draft, river);
    let applied: River;
    if (unchangedBase) {
      for (const part of changedParts(river)) writePart(draft, part.vertex, part.part, part.after);
      draft.waterfalls.push(...river.falls);
      applied = river;
    } else if (layer.generated) {
      applied = applyGeneratedRiver(draft, river as GeneratedRiver, selected && change.reshape);
    } else {
      applyAuthored(draft, river as AuthoredRiver);
      applied = river;
    }
    for (const patch of applied.patches) vertices.add(patch.vertex);
    if (layer.generated) generated.push(applied as GeneratedRiver);
    else authored.push(applied as AuthoredRiver);
  }
  const composedPatches = [...generated, ...authored].reduce((sum, river) => sum + river.patches.length, 0);
  if (composedPatches > Math.min(world.heights.length * 4, 262144))
    throw new Error("The composed channels exceed the working patch budget. Use narrower channels.");
  for (const part of manual) writePart(draft, part.vertex, part.part, part.actual);
  for (const vertex of vertices)
    draft.waterDepth[vertex] = Math.max(0, draft.waterSurface[vertex]! - draft.heights[vertex]!);
  for (const vertex of masks) suppressRiverVertex(draft, vertex);
  return { draft, generated, authored, baseVertices: [...vertices] };
};

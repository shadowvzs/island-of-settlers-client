import type { WorldData } from "../../world-data";
import { applyAuthoredRiver, type AuthoredRiver } from "../authored-rivers";
import type { GeneratedRiver } from "../generated-river-types";
import { composeRiverEdit, type RiverLayer } from "../river-composition";
import type { TerrainComponent } from "./terrain-component";

export interface CourseTransform {
  cx: number;
  cz: number;
  offsetX: number;
  offsetZ: number;
  scale: number;
}
const key = (layer: RiverLayer) => `${layer.generated ? "g" : "a"}:${layer.river.id}`;
const layers = (world: WorldData): RiverLayer[] => [
  ...(world.generatedRivers ?? []).map((river) => ({ generated: true, river })),
  ...(world.authoredRivers ?? []).map((river) => ({ generated: false, river }))
];

const selectionTouchesVertex = (world: WorldData, selection: TerrainComponent) => {
  const cells = new Set(selection.cells),
    stride = world.cellsX + 1;
  return (vertex: number) => {
    const x = vertex % stride,
      z = Math.floor(vertex / stride);
    return [-1, 0].some((dz) =>
      [-1, 0].some(
        (dx) =>
          x + dx >= 0 &&
          z + dz >= 0 &&
          x + dx < world.cellsX &&
          z + dz < world.cellsZ &&
          cells.has((z + dz) * world.cellsX + x + dx)
      )
    );
  };
};

/** Including connected courses is optional when the selected dry contour has no course to carry. */
export const hasSelectedRiver = (world: WorldData, selection: TerrainComponent) => {
  const touches = selectionTouchesVertex(world, selection);
  return layers(world).some(layer => layer.river.patches.some(patch => touches(patch.vertex)));
};

export const containedRiverGroup = (world: WorldData, selection: TerrainComponent) => {
  const cells = new Set(selection.cells), stride = world.cellsX + 1;
  const touches = selectionTouchesVertex(world, selection);
  const ordered = layers(world),
    selected = new Set<string>(),
    owned = new Set<number>();
  for (const layer of ordered)
    if (layer.river.patches.some((patch) => touches(patch.vertex))) {
      selected.add(key(layer));
      for (const patch of layer.river.patches) owned.add(patch.vertex);
    }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const layer of ordered) {
      if (selected.has(key(layer)) || !layer.river.patches.some((patch) => owned.has(patch.vertex)))
        continue;
      selected.add(key(layer));
      expanded = true;
      for (const patch of layer.river.patches) owned.add(patch.vertex);
    }
  }
  const group = ordered.filter((layer) => selected.has(key(layer)));
  if (!group.length)
    throw new Error("Select an editable complete course, or adopt its baked river first.");
  if (owned.size > 65536)
    throw new Error("The complete connected course group exceeds the transform budget.");
  // This explicit mode adopts the whole connected editable course group into the move,
  // including downstream sections outside the selected mountain contour. Never clip courses.
  if (selection.kind === "water")
    for (const cell of cells) {
      const v = Math.floor(cell / world.cellsX) * stride + (cell % world.cellsX);
      for (const vertex of [v, v + 1, v + stride, v + stride + 1])
        if (world.waterDepth[vertex]! > 0.01 && !owned.has(vertex))
          throw new Error(
            "The water selection includes an independent lake or ocean. Select only complete editable courses."
          );
    }
  const sourceCells = new Set(cells);
  for (const vertex of owned)
    for (const dz of [-1, 0])
      for (const dx of [-1, 0]) {
        const x = (vertex % stride) + dx,
          z = Math.floor(vertex / stride) + dz;
        if (x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ)
          sourceCells.add(z * world.cellsX + x);
      }
  return { group, owned, selected, sourceCells };
};

const compose = (
  world: WorldData,
  layer: RiverLayer,
  river: RiverLayer["river"] | null,
  reshape = false
) => {
  const next = composeRiverEdit(
    world,
    { generated: layer.generated, id: layer.river.id, river, reshape },
    applyAuthoredRiver
  );
  return { ...next.draft, generatedRivers: next.generated, authoredRivers: next.authored };
};

export const removeRiverGroup = (world: WorldData, group: RiverLayer[]) => {
  let draft = world;
  for (const layer of [...group].reverse()) draft = compose(draft, layer, null);
  return draft;
};

const transformedCourse = (layer: RiverLayer, transform: CourseTransform): RiverLayer["river"] => {
  const river = structuredClone(layer.river);
  river.points = river.points.map((point) => ({
    x: transform.cx + (point.x - transform.cx) * transform.scale + transform.offsetX,
    z: transform.cz + (point.z - transform.cz) * transform.scale + transform.offsetZ
  }));
  river.patches = [];
  river.falls = [];
  if (layer.generated) {
    const generated = river as GeneratedRiver;
    generated.widthSamples = generated.widthSamples.map((width) => width * transform.scale);
  } else {
    const authored = river as AuthoredRiver;
    authored.width *= transform.scale;
    if (authored.width < 1 || authored.width > 6)
      throw new Error("The resized authored course must retain a width between one and six tiles.");
  }
  // Erasures remain fixed in map space, including when a whole terrain group moves.
  return river;
};

/** Empty placeholders preserve original canonical generated→authored painter order while native
 * carvers rebuild selected channels. Every sparse before-patch comes from the actual new underlay. */
export const recarveRiverGroup = (
  world: WorldData,
  original: WorldData,
  group: RiverLayer[],
  selected: Set<string>,
  transform: CourseTransform
) => {
  const originals = layers(original);
  let draft: WorldData = {
    ...world,
    generatedRivers: originals
      .filter((layer) => layer.generated)
      .map((layer) =>
        selected.has(key(layer))
          ? (transformedCourse(layer, transform) as GeneratedRiver)
          : world.generatedRivers!.find((river) => river.id === layer.river.id)!
      ),
    authoredRivers: originals
      .filter((layer) => !layer.generated)
      .map((layer) =>
        selected.has(key(layer))
          ? (transformedCourse(layer, transform) as AuthoredRiver)
          : world.authoredRivers!.find((river) => river.id === layer.river.id)!
      )
  };
  for (const layer of group) {
    const current = layers(draft).find((candidate) => key(candidate) === key(layer))!;
    draft = compose(draft, current, current.river, layer.generated);
  }
  return draft;
};

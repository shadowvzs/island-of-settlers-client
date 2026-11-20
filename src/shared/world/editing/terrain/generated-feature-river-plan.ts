import type { WorldData } from "../../world-data";
import type { AuthoredRiver } from "../authored-rivers";
import type { GeneratedRiver } from "../generated-river-types";
import type { TerrainComponent } from "./terrain-component";

type River = AuthoredRiver | GeneratedRiver;
interface RiverMove {
  offsetX: number;
  offsetZ: number;
  scale: number;
}
export const riverMoveValues = (world: WorldData, vertex: number) => [
  world.heights[vertex]!,
  world.waterSurface[vertex]!,
  world.waterDepth[vertex]!,
  world.flow[vertex * 2]!,
  world.flow[vertex * 2 + 1]!,
  world.riverDistance[vertex]!
];
export const writeRiverMoveValues = (
  world: WorldData,
  vertex: number,
  parts: readonly number[]
) => {
  world.heights[vertex] = parts[0]!;
  world.waterSurface[vertex] = parts[1]!;
  world.waterDepth[vertex] = parts[2]!;
  world.flow[vertex * 2] = parts[3]!;
  world.flow[vertex * 2 + 1] = parts[4]!;
  world.riverDistance[vertex] = parts[5]!;
};

export const collectRiverOwnership = (
  world: WorldData,
  selection: TerrainComponent,
  transform: RiverMove
) => {
  const cells = new Set(selection.cells),
    stride = world.cellsX + 1;
  const touches = (vertex: number) => {
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
  const all: (AuthoredRiver | GeneratedRiver)[] = [
    ...(world.generatedRivers ?? []),
    ...(world.authoredRivers ?? [])
  ];
  const rivers = all.filter((river) =>
    river.patches.some((patch) => touches(patch.vertex) && (patch.after[3] || patch.after[4]))
  );
  if (!rivers.length)
    throw new Error(
      "This flowing water has no editable channel definition. Adopt its complete course first."
    );
  if (
    transform.scale !== 1 ||
    !Number.isInteger(transform.offsetX) ||
    !Number.isInteger(transform.offsetZ)
  )
    throw new Error(
      "Flowing channel groups support whole-tile movement; resizing would resample their saved grade."
    );
  const owned = new Set<number>();
  for (const river of rivers)
    for (const patch of river.patches) {
      if (patch.after[2]! > 0.01 && !touches(patch.vertex))
        throw new Error("Select the complete flowing channel and all its connected water first.");
      if (owned.has(patch.vertex))
        throw new Error(
          "Overlapping river layers must be edited with their course tools before this exact translation."
        );
      owned.add(patch.vertex);
    }
  if (owned.size > 32768)
    throw new Error("This complete channel exceeds the terrain movement budget.");
  for (const river of all)
    if (!rivers.includes(river) && river.patches.some((patch) => owned.has(patch.vertex)))
      throw new Error(
        "This channel shares terrain with another river layer. Edit its course instead."
      );
  for (const cell of cells) {
    const vertex = Math.floor(cell / world.cellsX) * stride + (cell % world.cellsX);
    for (const v of [vertex, vertex + 1, vertex + stride, vertex + stride + 1])
      if (world.waterDepth[v]! > 0.01 && !owned.has(v))
        throw new Error(
          "The selected water includes an unowned lake or ocean; only complete editable channels can move."
        );
  }
  return { cells, stride, all, rivers, owned };
};

export const planRiverChannel = (
  world: WorldData,
  all: River[],
  rivers: River[],
  owned: Set<number>,
  transform: RiverMove
) => {
  const stride = world.cellsX + 1;
  const draft: WorldData = {
    ...world,
    heights: world.heights.slice(),
    waterSurface: world.waterSurface.slice(),
    waterDepth: world.waterDepth.slice(),
    flow: world.flow.slice(),
    riverDistance: world.riverDistance.slice(),
    lakeWater: world.lakeWater?.slice(),
    props: {
      ...world.props,
      x: world.props.x.slice(),
      y: world.props.y.slice(),
      z: world.props.z.slice()
    }
  };
  const destinationVertices = new Set<number>();
  const destination = (vertex: number) => {
    const x = (vertex % stride) + transform.offsetX;
    const z = Math.floor(vertex / stride) + transform.offsetZ;
    if (x < 2 || z < 2 || x >= world.cellsX - 1 || z >= world.cellsZ - 1)
      throw new Error("Keep the complete flowing channel inside the map border.");
    return z * stride + x;
  };
  for (const river of rivers)
    for (const patch of river.patches) {
      if (
        riverMoveValues(world, patch.vertex)
          .slice(0, 5)
          .some((value, part) => value !== patch.after[part])
      )
        throw new Error(
          "This channel contains later terrain or water edits. Resolve them with its course tools first."
        );
      writeRiverMoveValues(draft, patch.vertex, patch.before);
      destinationVertices.add(destination(patch.vertex));
    }
  for (const river of all)
    if (
      !rivers.includes(river) &&
      river.patches.some((patch) => destinationVertices.has(patch.vertex))
    )
      throw new Error("The destination intersects another owned river channel.");
  let verticalOffset: number | undefined;
  for (const river of rivers)
    for (const patch of river.patches) {
      const vertex = destination(patch.vertex);
      if (
        draft.waterDepth[vertex]! > 0.01 ||
        Math.hypot(draft.flow[vertex * 2]!, draft.flow[vertex * 2 + 1]!) > 0.01
      )
        throw new Error("The destination of an exact channel move must be dry.");
      const delta = draft.heights[vertex]! - patch.before[0]!;
      verticalOffset ??= delta;
      if (Math.abs(delta - verticalOffset) > 0.02)
        throw new Error(
          "The destination ground does not preserve this channel's downhill grade. Choose matching terrain or edit its course."
        );
    }
  const dy = verticalOffset ?? 0;
  const movedRivers = new Map<AuthoredRiver | GeneratedRiver, AuthoredRiver | GeneratedRiver>();
  for (const river of rivers) {
    const next = structuredClone(river);
    next.points = river.points.map((point) => ({
      x: point.x + transform.offsetX,
      z: point.z + transform.offsetZ
    }));
    next.patches = river.patches.map((patch) => {
      const vertex = destination(patch.vertex),
        before = riverMoveValues(draft, vertex),
        after = [...patch.after];
      after[0] = patch.after[0]! + dy;
      // A dry bank does not gain an invented below-ground water plane.
      after[1] = patch.after[2]! > 0.01 ? patch.after[1]! + dy : Math.min(before[1]!, after[0]!);
      after[2] = Math.max(0, after[1]! - after[0]!);
      if (after[2]! > 0.01 && after[1]! <= world.seaLevel + 0.01)
        throw new Error("Keep the moved channel above ocean level.");
      writeRiverMoveValues(draft, vertex, after);
      return { vertex, before, after: riverMoveValues(draft, vertex) };
    });
    next.falls = river.falls.map((fall) => ({
      ...fall,
      x: fall.x + transform.offsetX,
      z: fall.z + transform.offsetZ,
      poolX: fall.poolX + transform.offsetX,
      poolZ: fall.poolZ + transform.offsetZ,
      top: fall.top + dy,
      bottom: fall.bottom + dy
    }));
    if ("profile" in next) next.profile = next.profile.map((height) => height + dy);
    // Suppression remains fixed map-space metadata, consistent with the existing course editor.
    if (next.suppressedVertices?.length)
      throw new Error(
        "Clear this channel's fixed water erasures before moving its complete terrain group."
      );
    movedRivers.set(river, next);
  }
  const affected = new Set([...owned, ...destinationVertices]);
  return { draft, movedRivers, affected };
};

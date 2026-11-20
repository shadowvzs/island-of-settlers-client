import type { PeachTreeGraph } from "../../../render-common/plants/flowering-peach-graph";

export { createPeachCrownLayout } from "../../../render-common/plants/flowering-peach-physical";

export const PEACH_CROWN_ATLAS = { columns: 8, rows: 16, tile: 128, elevations: [30, 55] } as const;

/** Preserve whole real flower-bearing sprigs so selected close details have real woody support. */
export const selectPeachCrownDetails = (graph: PeachTreeGraph, detailed: boolean) => {
  const flowers = new Set<number>(), heroFlowers = new Set<number>(), leaves = new Set<number>();
  const wood = new Set(graph.limbs.flatMap((limb, index) => limb.role === "twig" ? [] : [index]));
  for (const [groupIndex, group] of graph.crownGroups.entries()) {
    const bearings = new Map<number, number[]>();
    for (let index = group.flowerStart; index < group.flowerEnd; index++) {
      const bearing = graph.flowerBearings[index]!;
      const indices = bearings.get(bearing) ?? []; indices.push(index); bearings.set(bearing, indices);
    }
    const sprigs = [...bearings.values()].filter(indices => indices.length === 6);
    if (sprigs.length < 3) throw new Error("Peach crown has insufficient supported flowering sprigs");
    const selectedSprigs = detailed ? [.07, .40, .73].map(fraction => sprigs[Math.floor(sprigs.length * fraction)]!) : [sprigs[Math.floor(sprigs.length * .07)]!];
    const selected = selectedSprigs.flat();
    selected.forEach(index => flowers.add(index));
    selected.slice(0, detailed ? 3 : 2).forEach(index => heroFlowers.add(index));
    const desiredLeaves = detailed ? 8 : 2 - groupIndex % 2;
    for (let leaf = 0; leaf < desiredLeaves; leaf++)
      leaves.add(group.leafStart + Math.floor(leaf * (group.leafEnd - group.leafStart) / desiredLeaves));
  }
  const keepBearing = (index: number) => {
    let next: number | null = index;
    while (next !== null && !wood.has(next)) { wood.add(next); next = graph.limbs[next]!.parent; }
  };
  flowers.forEach(index => keepBearing(graph.flowerBearings[index]!));
  leaves.forEach(index => keepBearing(graph.leafBearings[index]!));
  return { flowers, heroFlowers, leaves, wood };
};


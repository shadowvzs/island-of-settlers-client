import type { ConstructionMaterials } from "./construction-costs";

const ordinaryPiles = (cost: ConstructionMaterials) => Object.keys(cost)
  .filter(ware => cost[ware]! > 0).every(ware => ware === "planks" || ware === "stone");

/** Large recipes use representative stock props; their complete paid goods remain in site input. */
export const constructionStockDisplayCapacity = (cost: ConstructionMaterials, ware: string) =>
  ordinaryPiles(cost) ? cost[ware] ?? 0 : Math.min(cost[ware] ?? 0, 6);

/** Local site coordinates shared by physical handoffs and native stock instances. */
export const constructionStockLayout = (cost: ConstructionMaterials, ware: string, slot: number,
  width: number, depth: number) => {
  const capacity = constructionStockDisplayCapacity(cost, ware);
  if (!capacity) return undefined;
  const position = Math.min(Math.max(0, slot), capacity - 1);
  const wares = Object.keys(cost).filter(key => cost[key]! > 0);
  if (ordinaryPiles(cost)) {
    const x = (ware === "planks" ? -1 : 1) *
      (width / 2 - .36 - (ware === "stone" ? position % 3 * .36 : 0));
    return { x, z: depth / 2 - .6, layer: ware === "planks" ? position : Math.floor(position / 3),
      approach: { x, z: depth / 2 + .27 }, slot: position };
  }
  // Perimeter stacks leave the central front doorway and road strip open. The final back bay
  // accommodates textile monuments without shifting the ten established material contacts.
  const anchors = [
    { x: -width / 2 + 1, z: depth / 2 - .33, dx: 0, dz: 1 },
    { x: width / 2 - 1, z: depth / 2 - .33, dx: 0, dz: 1 },
    { x: -width / 2 + .33, z: -depth / 4, dx: -1, dz: 0 },
    { x: -width / 2 + .33, z: 0, dx: -1, dz: 0 },
    { x: -width / 2 + .33, z: depth / 4, dx: -1, dz: 0 },
    { x: width / 2 - .33, z: -depth / 4, dx: 1, dz: 0 },
    { x: width / 2 - .33, z: 0, dx: 1, dz: 0 },
    { x: width / 2 - .33, z: depth / 4, dx: 1, dz: 0 },
    { x: -width / 4, z: -depth / 2 + .33, dx: 0, dz: -1 },
    { x: width / 4, z: -depth / 2 + .33, dx: 0, dz: -1 },
    { x: 0, z: -depth / 2 + .33, dx: 0, dz: -1 }
  ];
  const anchor = anchors[wares.indexOf(ware)];
  if (!anchor) return undefined;
  const column = (position % 3 - 1) * .36;
  const x = anchor.x + anchor.dz * column, z = anchor.z + anchor.dx * column;
  return { x, z, layer: Math.floor(position / 3), slot: position,
    approach: { x: anchor.dx ? anchor.dx * (width / 2 + .27) : x,
      z: anchor.dz ? anchor.dz * (depth / 2 + .27) : z } };
};

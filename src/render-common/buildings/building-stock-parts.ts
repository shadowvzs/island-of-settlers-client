import type { AddPart } from "./roman-resource-workshops";

/** Scope all pieces of one authored ware to one inventory slot. */
export const withBuildingStock = (part: AddPart, ware: string, slot: number,
  kind: "input" | "output" = "output", wares?: readonly string[]): AddPart =>
  (surface, position, size, stage, shape, rotation, tint) =>
    part(surface, position, size, stage, shape, rotation, tint, { ware, slot, kind, wares });

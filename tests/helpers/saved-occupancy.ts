import { packSparseCells, unpackSparseCells } from "../../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";

/** Edits the dense occupancy grid of a saved settlement (its stored form is sparse cells). */
export const editSavedOccupancy = (saved: SettlementSaveV1, edit: (grid: Uint8Array) => void) => {
  const grid = unpackSparseCells(saved.occupied, saved.world.cellsX * saved.world.cellsZ);
  edit(grid);
  saved.occupied = packSparseCells(grid);
};

import { entryByCode } from "@shared/catalog";

import { ZONE_REACH } from "../../render-common/mine-field";
import { contentDescriptor } from "../../shared/i18n/content-text";
import { listOreQuantities, setOreZoneQuantity } from "../../shared/world/editing/ore-quantity";
import { EMPTY_REGION, expandRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditRefresher } from "./editor-refresh";
import type { EditorStore } from "./editor-store";
import { bumpBuildRevision } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore, type FieldOption, keepOption } from "./section-store";

/** The catalog name of a mine zone ore byte (its number for an unknown byte). */
const oreMessage = (ore: number) => {
  const entry = entryByCode("deposit", ore);
  return entry ? contentDescriptor(entry.text.name) : String(ore);
};

/** Editing remaining ore is an authoring command, never a geologist survey or stock grant. */
export const createOreEditor = (world: WorldData, store: EditorStore, history: EditorHistory,
  refresher: EditRefresher, onEdit: () => boolean | void) => {
  const section = createSectionStore({
    each: "0", options: [] as readonly FieldOption[], selected: "", status: "" as EditorText, total: "0",
    totalMax: String(world.cellsX * world.cellsZ * 255)
  });
  let quantities = listOreQuantities(world);
  const show = () => {
    const selected = quantities.find(quantity => String(quantity.id) === section.get().selected);
    if (!selected) {
      section.update({ status: M.hints.paintOreFirst });
      return;
    }
    section.update({
      each: String(selected.maximum),
      status: editorMessage(M.variable.oreStatus, {
        capacity: selected.cells * 255,
        cells: selected.cells,
        maximum: selected.maximum,
        minimum: selected.minimum,
        total: selected.total
      }),
      total: String(selected.total),
      totalMax: String(selected.cells * 255)
    });
  };
  const refresh = () => {
    const previous = section.get().selected;
    quantities = listOreQuantities(world);
    const options = quantities.map(quantity => ({
      label: editorMessage(M.coordinate.oreOption, {
        id: quantity.id,
        ore: oreMessage(quantity.ore),
        total: quantity.total
      }),
      value: String(quantity.id)
    }));
    section.update({ options, selected: keepOption(options, previous) });
    show();
  };
  const apply = (mode: "per-cell" | "total") => {
    const field = mode === "per-cell" ? "each" : "total";
    if (!section.get().selected || !section.reportValidity(field)) return;
    if (onEdit() === false) return;
    history.begin();
    try {
      const changed = setOreZoneQuantity(world, Number(section.get().selected), section.valueAsNumber(field), mode);
      if (changed) {
        const cells = expandRegion(world, changed.cells, ZONE_REACH);
        bumpBuildRevision(world);
        const outcome = { cells, ground: false, mineStones: true, props: false, removed: [], stoneCells: EMPTY_REGION };
        refresher.queue(outcome); history.note(outcome); refresher.finishStroke();
        store.setHint(editorMessage(M.hints.oreApplied, { total: changed.total }));
      } else store.setHint(M.hints.oreInvalid, true);
    } finally { history.endStroke(); refresh(); }
  };
  history.subscribe(refresh); refresh();
  return {
    refresh,
    section,
    select: (selected: string) => { section.update({ selected }); show(); },
    setPerCell: () => apply("per-cell"),
    setTotal: () => apply("total")
  };
};

export type OreEditor = ReturnType<typeof createOreEditor>;

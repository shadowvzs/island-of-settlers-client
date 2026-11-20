import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import { findDecorationEntry, listDecorationEntries } from "../../../shared/world/editing/decoration-registry";
import { type DecorationPaletteEditor, PALETTE_MODE } from "../decoration-palette-editor";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import {
  filterPaletteTiles, getPaletteCategoryTabs, getPaletteStatus, getTileTitle, getVariantOptions, toPaletteRows,
  toPaletteTile
} from "./decoration-palette-helpers";
import { useSection } from "./use-section";

const useFailedIcons = () => {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const onIconError = (id: string) => setFailed(previous => new Set(previous).add(id));
  return { failed, onIconError };
};

/** The palette's prepared view: category tabs, filtered tiles, the selected model's options and status. */
export const useDecorationPalette = (editor: DecorationPaletteEditor) => {
  const { i18n } = useLingui();
  const { field, view } = useSection(editor.section);
  const { failed, onIconError } = useFailedIcons();
  const tiles = useMemo(() => listDecorationEntries().map(entry => toPaletteTile(entry, i18n)), [i18n]);
  const shown = useMemo(() => filterPaletteTiles(tiles, view.category, view.search),
    [tiles, view.category, view.search]);
  const entry = findDecorationEntry(view.selected);
  const selectedTile = tiles.find(tile => tile.id === view.selected);
  return {
    categories: getPaletteCategoryTabs(view.category, i18n),
    categoriesLabel: translateMessage(i18n, M.palette.categories),
    emptyText: translateMessage(i18n, M.palette.empty),
    gridLabel: translateMessage(i18n, M.palette.section),
    placeActive: view.mode === PALETTE_MODE.place,
    removeActive: view.mode === PALETTE_MODE.remove,
    rotation: field("rotation"),
    scale: field("scale"),
    scaleLimits: entry?.source === "ground" ? entry.scale : null,
    search: view.search,
    searchLabel: translateMessage(i18n, M.palette.search),
    searchPlaceholder: translateMessage(i18n, M.palette.searchPlaceholder),
    selectedTitle: selectedTile ? getTileTitle(selectedTile) : "",
    status: getPaletteStatus(shown.length, tiles.length, view.placed, view.blocked),
    tiles: toPaletteRows(shown, view.selected, failed),
    variant: field("variant"),
    variantOptions: getVariantOptions(entry, i18n),
    onCategory: editor.setCategory,
    onIconError,
    onPick: editor.select,
    onPlace: editor.startPlacing,
    onRemove: editor.startRemoving,
    onSearch: editor.setSearch
  };
};

export type DecorationPaletteView = ReturnType<typeof useDecorationPalette>;

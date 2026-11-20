import type { I18n } from "@lingui/core";

import { CELL_FORMATS } from "../../../../../../island-of-settlers-shared/src/script/constants";
import type {
  MultiboardCell, MultiboardColumn, MultiboardDefinition
} from "../../../../../../island-of-settlers-shared/src/script/types/multiboards";
import type { ScriptVariable } from "../../../../../../island-of-settlers-shared/src/script/types/script";
import type { ValueType } from "../../../../../../island-of-settlers-shared/src/script/types/values";
import { displayQuestText } from "../../../../shared/i18n/quest-text";
import { translateMessage } from "../../../../shared/i18n/translate";
import { createSlotPart, EMPTY_SCOPE, type PartScope, type SlotPart } from "../block-parts";
import { CATALOG_KINDS } from "../constants";
import type { DescribeContext } from "../describe";
import { showBlock, type ShownBlock } from "../form-rows";
import { type NodePath, pathKey } from "../paths";
import type { ShownIssue } from "../validation";
import { COLUMN_ALIGNS, ROW_SOURCES } from "./constants";
import { BOARD_MESSAGES as M } from "./messages";

/**
 * Pure view preparation of the board editor (design §13.5): the board list, column rows with their cell slots
 * (typed by the format, `random` never offered), static rows and the select options.
 */

/** Cells read their row (label, index, item, player); `random` is refused there. */
export const CELL_SCOPE: PartScope = { ...EMPTY_SCOPE, cell: true };

/** Board paths are below the variable: `initial.value.…` (validation issues use the same paths). */
export const BOARD_PATH: NodePath = ["initial", "value"];

/** The value type a cell expression must have: text cells take any scalar, every other format a number. */
const cellType = (format: MultiboardCell["format"]): ValueType | null => (format === "text" ? null : "number");

const cellSlots = (cell: MultiboardCell | undefined, columnId: string, context: DescribeContext): SlotPart[] => {
  if (!cell) return [];
  const path = [...BOARD_PATH, "cells", columnId];
  const spec = { kind: "value" as const, scope: CELL_SCOPE, type: cellType(cell.format) };
  if (cell.format === "fraction") return [
    createSlotPart("current", spec, [...path, "current"], cell.current, false, context),
    createSlotPart("target", spec, [...path, "target"], cell.target, false, context)
  ];
  return [createSlotPart("value", spec, [...path, "expr"], cell.expr, false, context)];
};

/** A sentence block of one cell's slots, with its issues and red slots. */
const cellBlock = (slots: readonly SlotPart[], key: string, path: NodePath, issues: readonly ShownIssue[]):
  ShownBlock => showBlock({ disabled: false, key, parts: slots.flatMap((slot, index) => (index
  ? [{ kind: "text" as const, text: " / " }, slot] : [slot])), path }, issues);

export const columnRows = (board: MultiboardDefinition, context: DescribeContext, issues: readonly ShownIssue[]) =>
  board.columns.map((column: MultiboardColumn, index) => {
    const cell = board.cells[column.id];
    const path = [...BOARD_PATH, "cells", column.id];
    const name = displayQuestText(column.header, context.i18n) || column.id;
    const text = (descriptor: typeof M.moveLeft) => translateMessage(context.i18n, descriptor, { name });
    return {
      align: column.align,
      cell: cellBlock(cellSlots(cell, column.id, context), pathKey(path), path, issues),
      first: index === 0,
      format: cell?.format ?? "number",
      header: column.header,
      id: column.id,
      last: index === board.columns.length - 1,
      moveLeftLabel: text(M.moveLeft),
      moveRightLabel: text(M.moveRight),
      name,
      removeLabel: text(M.removeColumn),
      width: column.width === "auto" ? "" : String(column.width)
    };
  });

export type BoardColumnRow = ReturnType<typeof columnRows>[number];

/** Fixed rows with their label, icon slot and labels. */
export const staticRowViews = (board: MultiboardDefinition, context: DescribeContext) => {
  if (board.rows.kind !== "static") return [];
  return board.rows.rows.map((row, index) => {
    const number = index + 1;
    const iconPath = [...BOARD_PATH, "rows", "rows", index, "icon"];
    return {
      icon: showBlock({ disabled: false, key: pathKey(iconPath), parts: [createSlotPart("icon",
        { kind: "content", kinds: CATALOG_KINDS }, iconPath, row.icon, true, context)], path: iconPath }, []).parts,
      id: row.id,
      label: row.label,
      moveUpLabel: translateMessage(context.i18n, M.moveRowUp, { number }),
      removeLabel: translateMessage(context.i18n, M.removeRow, { number })
    };
  });
};

/** The select options of the editor: formats, aligns, row sources, sort directions. */
export const boardOptions = (i18n: I18n | undefined) => ({
  aligns: COLUMN_ALIGNS.map(key => ({ key, label: translateMessage(i18n, M.aligns[key]) })),
  directions: [{ key: "desc", label: translateMessage(i18n, M.descending) },
    { key: "asc", label: translateMessage(i18n, M.ascending) }],
  formats: CELL_FORMATS.map(key => ({ key, label: translateMessage(i18n, M.formats[key]) })),
  rowSources: ROW_SOURCES.map(key => ({ key, label: translateMessage(i18n, M.rowSource[key]) }))
});

/** List variables a "one row per list item" board may read. */
export const listVariables = (variables: readonly ScriptVariable[]) => variables
  .filter(item => item.type === "number[]" || item.type === "string[]" || item.type === "actorGroup");

/** The boards of the script for the list (title in the editor language, the variable name below). */
export const boardListRows = (variables: readonly ScriptVariable[], selectedId: string | null,
  i18n: I18n | undefined) => variables.flatMap(variable => {
  if (variable.initial.type !== "multiboard") return [];
  return [{ id: variable.id, name: variable.name, selected: variable.id === selectedId,
    title: displayQuestText(variable.initial.value.title, i18n) || variable.name }];
});

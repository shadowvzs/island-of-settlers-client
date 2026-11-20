import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { getTabRows, type TabRow } from "../../components/helpers";
import { troopIcon } from "../../settlement/army-icons";
import {
  BRUSH_SIZES, EDITOR_TABS, type EditorTabId, type MapAction, type ToolChoice, type ToolEntry
} from "../editor-catalog";
import { type EditorState, type EditorToolKind, isSameTool } from "../editor-store";
import { MARBLE_MATERIALS } from "../marble-editor";
import { type EditorText, editorTextSource, MAP_EDITOR_MESSAGES as M } from "../messages";
import { type ActionIcon, getActionIcon, getToolClassName } from "./action-icons";

/** Brush strength levels (share of the full strength). */
export const BRUSH_STRENGTHS: readonly number[] = [.1, .25, .5, 1, 1.5, 2];
export const getBrushSizeLevels = (i18n?: I18n) =>
  BRUSH_SIZES.map(size => translateMessage(i18n, M.brush.sizeLevel, { size }));
export const getBrushStrengthLevels = (i18n?: I18n) =>
  BRUSH_STRENGTHS.map(value => translateMessage(i18n, M.brush.strengthLevel, { percent: Math.round(value * 100) }));

/** A tool button: what it picks, how it is named and whether its tool is active. */
export interface ToolButtonRow {
  action: MapAction;
  active: boolean;
  key: string;
  kind: EditorToolKind;
  value: number;
}

/** A tool choice or a tool without choices, as a button picking `kind` / `value`. */
export interface ToolButtonSpec {
  action: MapAction;
  kind: EditorToolKind;
  value: number;
}

export const toChoiceSpecs = (kind: EditorToolKind, choices: readonly ToolChoice[]): ToolButtonSpec[] =>
  choices.map(({ icon, label, message, nations, value }) =>
    ({ action: { icon, label, message, nations }, kind, value }));

export const toEntrySpec = ({ icon, kind, label, message, nations, value = 0 }: ToolEntry): ToolButtonSpec =>
  ({ action: { icon, label, message, nations }, kind, value });

/** The buttons of a grid, marked while their tool is the active one. */
export const toToolRows = (specs: readonly ToolButtonSpec[], tool: EditorState["tool"]): ToolButtonRow[] =>
  specs.map(spec => ({ ...spec, active: isSameTool(tool, spec.kind, spec.value), key: `${spec.kind}:${spec.value}` }));

/** A tab of the editor panel ready to render. */
export interface EditorTabRow extends TabRow<EditorTabId> {
  className: string;
  icon: ActionIcon | null;
  name: string;
}

/** The categories with ids, selection, roving tab index and icon (Units shows the scenario nation's soldier). */
export const getEditorTabRows = (prefix: string, active: EditorTabId, nation: string, i18n?: I18n): EditorTabRow[] => {
  const items = EDITOR_TABS.map(tab => ({
    content: tab.id,
    id: tab.id,
    label: translateMessage(i18n, tab.labelMessage)
  }));
  const rows = getTabRows<EditorTabId>(prefix, items, EDITOR_TABS.findIndex(tab => tab.id === active));
  return rows.map((row, index) => {
    const tab = EDITOR_TABS[index]!;
    const icon = tab.id === "units" ? { src: troopIcon(nation, "shield") } : getActionIcon(tab.icon);
    return { ...row, className: getToolClassName("map-editor__tab", row.selected), icon,
      name: translateMessage(i18n, tab.nameMessage) };
  });
};

/** A unique id prefix of one panel's tabs from a `useId` value. */
export const toEditorTabPrefix = (id: string) => `map-editor-${id.replace(/[^\w-]/g, "")}`;

/** The hint line: its text, tone and whether it shows. */
export const getStatusView = ({ hint, hintIsRefusal }: Pick<EditorState, "hint" | "hintIsRefusal">) => ({
  className: hintIsRefusal ? "map-editor__status is-refusal" : "map-editor__status",
  hidden: editorTextSource(hint) === "",
  text: hint as EditorText
});

/** The stone material palette: each material's button, pressed while it is the armed placement tool. */
export const toMaterialRows = (tool: EditorState["tool"]) => MARBLE_MATERIALS.map((row, index) => ({
  ...row,
  className: getToolClassName("map-editor__tool", isSameTool(tool, "marble", index)),
  pressed: isSameTool(tool, "marble", index)
}));

/** The target height as the field shows it (two decimals at most). */
export const formatTargetHeight = (height: number) => String(Math.round(height * 100) / 100);

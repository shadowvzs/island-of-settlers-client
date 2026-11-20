import { useLingui } from "@lingui/react";
import { type KeyboardEvent,useState } from "react";

import { useExternalStore } from "../../components/external-store";
import { SCREENSHOT_HOTKEY } from "../../screenshot/constants";
import { formatHotkeyCode, HOTKEY_ACTIONS, HOTKEY_DEFAULTS, type HotkeyAction, hotkeySettings } from "./bindings";
import { HOTKEY_MESSAGES as M } from "./messages";

export const useHotkeySettings = () => {
  const { i18n } = useLingui();
  const bindings = useExternalStore(hotkeySettings);
  const [editing, setEditing] = useState<HotkeyAction | null>(null);
  const [error, setError] = useState("");
  const onKeyDown = (action: HotkeyAction, event: KeyboardEvent<HTMLInputElement>) => {
    if (editing !== action || event.nativeEvent.isComposing || event.repeat) return;
    if (event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setEditing(null);
      setError("");
      event.currentTarget.blur();
      return;
    }
    if (/^(Shift|Control|Alt|Meta)$/.test(event.key)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      setError(i18n._(M.reserved));
      return;
    }
    const result = hotkeySettings.rebind(action, event.code);
    if (result.kind === "conflict") {
      setError(i18n._({ ...M.conflict, values: { action: i18n._(M.actions[result.action]) } }));
      return;
    }
    if (result.kind === "reserved") {
      setError(i18n._(M.reserved));
      return;
    }
    setEditing(null);
    setError("");
    event.currentTarget.blur();
  };
  /** Control groups use a fixed Shift modifier outside the rebinding store (military controls §8). */
  const fixedRows = [
    { id: "screenshot", label: i18n._(M.screenshot), value: SCREENSHOT_HOTKEY },
    { id: "groupRecall", label: i18n._(M.controlGroups.recall), value: "1–9" },
    { id: "groupAssign", label: i18n._(M.controlGroups.assign), value: "Shift+1–9" }
  ];
  const rows = HOTKEY_ACTIONS.map(action => {
    let value = formatHotkeyCode(bindings[action]);
    if (editing === action) value = i18n._(M.capture);
    return { action, label: i18n._(M.actions[action]), mode: HOTKEY_DEFAULTS[action].mode, value };
  });
  return {
    error,
    groups: [
      { fixedRows, id: "game", label: i18n._(M.game), rows: rows.filter(row => row.mode !== "possessed") },
      {
        fixedRows: [], id: "possessed", label: i18n._(M.possessed),
        rows: rows.filter(row => row.mode === "possessed")
      }
    ],
    fixedTitle: i18n._(M.fixedBinding),
    hint: i18n._(M.hint),
    resetLabel: i18n._(M.reset),
    title: i18n._(M.title),
    onBlur: () => setEditing(null),
    onFocus: (action: HotkeyAction) => { setEditing(action); setError(""); },
    onKeyDown,
    onReset: () => { hotkeySettings.reset(); setError(""); setEditing(null); }
  };
};

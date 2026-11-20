import { useState } from "react";

import type { AddKind } from "./add-options";
import type { PickerSpec } from "./block-parts";

/** A slot picker opening: what it edits and how the chosen value is stored. */
export interface PickerRequest {
  label: string;
  optional: boolean;
  spec: PickerSpec;
  value: unknown;
  apply: (value: unknown) => void;
}

/** An add list opening ("+ event", "+ condition", "+ action") and where the chosen entry goes. */
export interface AddRequest {
  kind: AddKind;
  apply: (key: string) => void;
}

/** The workspace's dialogs: one slot picker, one add list and the template dialog at a time. */
export const useScriptDialogs = () => {
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [add, setAdd] = useState<AddRequest | null>(null);
  const [templates, setTemplates] = useState(false);
  return {
    add,
    picker,
    templates,
    closeAdd: () => setAdd(null),
    closePicker: () => setPicker(null),
    closeTemplates: () => setTemplates(false),
    openAdd: setAdd,
    openPicker: setPicker,
    openTemplates: () => setTemplates(true)
  };
};

export type ScriptDialogs = ReturnType<typeof useScriptDialogs>;

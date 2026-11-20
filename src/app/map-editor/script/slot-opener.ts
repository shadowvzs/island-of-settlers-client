import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { SlotPart } from "./block-parts";
import { SCRIPT_MESSAGES as M } from "./messages";
import { getAtPath, setAtPath } from "./paths";
import type { ScriptDialogs } from "./use-script-dialogs";

/**
 * A choice stored as a plain string (compare/math operators, a built-in quest goal's quantifier) rather than a
 * literal expression.
 */
const isPlainChoice = (part: SlotPart, node: unknown) => part.spec.kind === "choice" &&
  (part.path.at(-1) === "op" || typeof getAtPath(node, part.path) === "string");

/** Opens the slot picker for a sentence slot; the chosen value is written at the slot's path in the edited node. */
export const slotOpener = <T>(i18n: I18n, dialogs: Pick<ScriptDialogs, "openPicker">,
  update: (change: (value: T) => T) => void) => (part: SlotPart) => dialogs.openPicker({
  label: translateMessage(i18n, M.picker.title, { slot: part.label }), optional: part.optional, spec: part.spec,
  value: part.value,
  apply: value => update(current => setAtPath(current, part.path, isPlainChoice(part, current)
    ? (value as { value?: unknown } | undefined)?.value : value))
});

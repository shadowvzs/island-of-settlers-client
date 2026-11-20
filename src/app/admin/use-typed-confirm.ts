import { useLingui } from "@lingui/react";
import { useState } from "react";

import { translateMessage } from "../../shared/i18n/translate";
import type { ConfirmRequest } from "./confirm-request";
import { confirmationMatches, errorText } from "./helpers";
import { MAINTENANCE_MESSAGES as M } from "./maintenance/messages";

/**
 * The typed confirmation dialog's state: the typed text and option, the run (once) and its error. A wrong text keeps
 * the run button disabled, so nothing is sent; Cancel never runs anything.
 */
export const useTypedConfirm = (request: ConfirmRequest, onDone: (status: string) => void) => {
  const { i18n } = useLingui();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [option, setOption] = useState(false);
  const [typed, setTyped] = useState("");
  const ready = confirmationMatches(typed, request.expected) && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      onDone(await request.run(option));
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return {
    busy,
    cancelLabel: translateMessage(i18n, M.confirm.cancel),
    error,
    hint: request.expected === null ? "" : translateMessage(i18n, M.confirm.typeToConfirm,
      { expected: request.expected }),
    inputLabel: translateMessage(i18n, M.confirm.input),
    needsTyping: request.expected !== null,
    option,
    ready,
    setOption,
    setTyped,
    submit,
    typed
  };
};

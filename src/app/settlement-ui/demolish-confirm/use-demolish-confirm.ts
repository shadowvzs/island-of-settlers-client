import { useEffect, useRef } from "react";

import { useExternalStore } from "../../components/external-store";
import { type DemolishConfirmation, listenForDemolishDismissal } from "../demolish-confirmation-helpers";

/**
 * The open question; while one is open, Escape and outside presses cancel it (global capture listeners)
 * and the Keep choice takes the focus each time a new question opens.
 */
export const useDemolishConfirm = (confirmation: DemolishConfirmation, target: EventTarget = globalThis) => {
  const question = useExternalStore(confirmation);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!question) return;
    keepRef.current?.focus();
    return listenForDemolishDismissal(target, confirmation.cancel);
  }, [confirmation, question, target]);
  return { keepRef, question };
};

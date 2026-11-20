import { useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex="0"]';

const trapTab = (event: KeyboardEvent, dialog: HTMLDivElement | null) => {
  const buttons = Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    .filter(element => !element.closest("[hidden]"));
  if (!buttons.length) return;
  const first = buttons[0]!, last = buttons[buttons.length - 1]!;
  if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
};

/** Confirmation belongs to one visible selection; Escape/Tab stay inside this modal. */
export const useUpgradeConfirmation = (buildingId: string, visible: boolean) => {
  const selection = visible ? buildingId : null;
  const [state, setState] = useState(() => ({ opened: false, selection }));
  if (state.selection !== selection) setState({ opened: false, selection });
  const triggerRef = useRef<HTMLButtonElement>(null), dialogRef = useRef<HTMLDivElement>(null);
  const opened = visible && state.selection === selection && state.opened;
  const close = useCallback(() => {
    setState(current => ({ ...current, opened: false }));
  }, []);
  useEffect(() => {
    if (!opened) return;
    const trigger = triggerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const info = dialogRef.current?.querySelector(".info-tooltip__button:focus");
        if (info?.getAttribute("aria-expanded") === "true") return;
        event.preventDefault(); event.stopPropagation(); close(); return;
      }
      if (event.key !== "Tab") return;
      trapTab(event, dialogRef.current);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (trigger?.isConnected && !trigger.closest("[hidden]")) trigger.focus();
    };
  }, [close, opened]);
  return { close, dialogRef, opened, open: () => setState({ opened: true, selection: buildingId }), triggerRef };
};

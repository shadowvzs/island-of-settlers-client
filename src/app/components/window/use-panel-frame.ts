import { useLayoutEffect, useRef } from "react";

import { registerSettlementWindowOrder } from "../../settlement-ui/window-order";
import { useAppendContent } from "./use-append-content";

/** A corner panel's z-order (raised on every opening) and its DOM content. */
export const usePanelFrame = (content: HTMLElement | undefined, open: boolean) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const activateRef = useRef<() => void>(null);
  useLayoutEffect(() => {
    const events = new AbortController();
    activateRef.current = registerSettlementWindowOrder(panelRef.current!, events.signal);
    return () => events.abort();
  }, []);
  useAppendContent(panelRef, content);
  useLayoutEffect(() => {
    if (open) activateRef.current!();
  }, [open]);
  return panelRef;
};

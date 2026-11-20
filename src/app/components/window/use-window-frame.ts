import { useLayoutEffect, useRef } from "react";

import { makeSettlementPanelDraggable } from "../../settlement-ui/drag";
import { getDragScope } from "./helpers";
import { useAppendContent } from "./use-append-content";

type Drag = ReturnType<typeof makeSettlementPanelDraggable>;

export interface WindowFrameBehaviour {
  /** Content shown below the header that another owner renders (a DOM element with its own React root). */
  content?: HTMLElement;
  /** Opening count: each increase while visible keeps the frame on screen, raises it and focuses it. */
  opened: number;
  visible: boolean;
  /** Where focus goes on open; the drag handle when absent. */
  focusOnOpen?: (handle: HTMLElement) => void;
  /** After each opening was shown and focused (e.g. scroll the content back to the top). */
  onOpened?: () => void;
}

/**
 * Drag (pointer and arrow keys), the shared z-order and the open effects of a window frame: on every open the
 * frame is clamped into the viewport, raised and focused.
 */
export const useWindowFrame = ({ content, focusOnOpen, onOpened, opened, visible }: WindowFrameBehaviour) => {
  const panelRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const handledRef = useRef(0);
  useLayoutEffect(() => {
    const panel = panelRef.current!;
    const drag = makeSettlementPanelDraggable(panel, handleRef.current!, () => getDragScope(panel));
    dragRef.current = drag;
    return () => drag.dispose();
  }, []);
  useAppendContent(panelRef, content);
  useLayoutEffect(() => {
    if (!visible || opened === handledRef.current) return;
    handledRef.current = opened;
    const drag = dragRef.current!;
    drag.constrain();
    drag.activate();
    const handle = handleRef.current!;
    if (focusOnOpen) focusOnOpen(handle);
    else handle.focus();
    onOpened?.();
  }, [focusOnOpen, opened, visible, onOpened]);
  return { handleRef, panelRef };
};

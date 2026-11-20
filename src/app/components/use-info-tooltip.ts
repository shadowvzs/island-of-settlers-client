import { type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { getTooltipPosition } from "./info-tooltip-helpers";

interface TooltipState {
  /** Opened by a click / tap: hover leaving does not close it. */
  pinned: boolean;
  shown: boolean;
}

const CLOSED: TooltipState = { pinned: false, shown: false };

/**
 * Open on hover, keyboard focus and tap (phones have no hover); close on Escape (kept from closing the
 * window), a press outside, a scroll (unless pinned by a tap), blur and mouse leave. Positions the tooltip inside the viewport once shown.
 */
export const useInfoTooltip = <Anchor extends HTMLElement = HTMLSpanElement>(content?: unknown) => {
  const id = `${useId()}-tooltip`;
  const anchorRef = useRef<Anchor>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TooltipState>(CLOSED);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const place = useCallback(() => {
    const root = anchorRef.current;
    const anchor = root?.tagName === "BUTTON" ? root : root?.querySelector("button");
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const size = { height: tooltip.offsetHeight, width: tooltip.offsetWidth };
    const next = getTooltipPosition(anchor.getBoundingClientRect(), size,
      { height: innerHeight, width: innerWidth });
    setPosition({ left: next.left, top: next.top });
  }, []);
  useLayoutEffect(() => {
    if (state.shown) place();
    // Content can change dimensions while a pinned tooltip remains open.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [content, place, state.shown]);
  useEffect(() => {
    if (!state.shown) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setState(CLOSED);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setState(CLOSED);
    };
    // A hover tooltip is placed once and closes on scroll. A tapped (pinned) one follows its anchor:
    // focusing the tapped button can itself scroll the list into view on phones.
    const onScroll = () => {
      if (state.pinned) place();
      else setState(CLOSED);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [place, state.pinned, state.shown]);
  return {
    anchorRef,
    id,
    position,
    shown: state.shown,
    tooltipRef,
    onBlur: () => setState(CLOSED),
    onClick: () => setState(current => (current.pinned ? CLOSED : { pinned: true, shown: true })),
    onFocus: () => setState(current => ({ ...current, shown: true })),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !state.shown) return;
      event.preventDefault();
      event.stopPropagation();
      setState(CLOSED);
    },
    onMouseEnter: () => setState(current => ({ ...current, shown: true })),
    onMouseLeave: () => setState(current => (current.pinned ? current : CLOSED))
  };
};

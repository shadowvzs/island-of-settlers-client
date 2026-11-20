import { useLingui } from "@lingui/react";
import { useEffect, useMemo, useRef } from "react";

import { displayQuestText } from "../../../shared/i18n/quest-text";
import { useExternalStore } from "../../components/external-store";
import {
  HIGHLIGHT_BUBBLE_GAP as BUBBLE_GAP, HIGHLIGHT_RING_PADDING as RING_PADDING, HIGHLIGHT_VIEWPORT_MARGIN as MARGIN
} from "./constants";
import type { HighlightStore, ShownHighlight } from "./highlight-store";
import { findShownUiAnchor } from "./ui-anchors";

export interface HighlightItem {
  effectId: string;
  text: string;
}

interface Placed {
  /** The ring was on screen at least once (an `until: "windowClosed"` highlight ends when it is gone again). */
  seen: boolean;
}

const placeRing = (ring: HTMLElement, rect: DOMRect) => {
  ring.style.transform = `translate(${rect.left - RING_PADDING}px, ${rect.top - RING_PADDING}px)`;
  ring.style.width = `${rect.width + RING_PADDING * 2}px`;
  ring.style.height = `${rect.height + RING_PADDING * 2}px`;
};

/** The bubble goes above the anchor, or below it when the anchor is near the top; clamped into the viewport. */
const placeBubble = (bubble: HTMLElement, rect: DOMRect) => {
  const width = bubble.offsetWidth, height = bubble.offsetHeight;
  const above = rect.top - RING_PADDING - BUBBLE_GAP - height;
  const top = above >= 0 ? above : rect.bottom + RING_PADDING + BUBBLE_GAP;
  const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN);
  bubble.style.transform = `translate(${left}px, ${top}px)`;
  bubble.dataset.side = above >= 0 ? "above" : "below";
};

/** One frame of placement: shown anchors get the ring, hidden ones hide it; a closed window ends its highlight. */
const placeAll = (
  list: readonly ShownHighlight[], nodes: Map<string, HTMLElement>, placed: Map<string, Placed>,
  onWindowClosed: (effectId: string) => void
) => {
  for (const highlight of list) {
    const node = nodes.get(highlight.effectId);
    if (!node) continue;
    const found = findShownUiAnchor(document, highlight.anchor);
    const state = placed.get(highlight.effectId) ?? { seen: false };
    placed.set(highlight.effectId, state);
    node.hidden = !found;
    if (!found) {
      if (state.seen && highlight.until === "windowClosed") onWindowClosed(highlight.effectId);
      continue;
    }
    state.seen = true;
    const rect = found.element.getBoundingClientRect();
    placeRing(node.querySelector<HTMLElement>(".script-highlight__ring")!, rect);
    const bubble = node.querySelector<HTMLElement>(".script-highlight__bubble");
    if (bubble) placeBubble(bubble, rect);
  }
};

/**
 * The overlay's subscription and placement: React renders only when the highlight list or the locale changes; a
 * requestAnimationFrame loop, running only while a highlight exists, writes positions straight into the nodes so
 * rings follow dragged windows and resized layouts without React renders.
 */
export const useHighlightLayer = (highlights: HighlightStore) => {
  const { i18n } = useLingui();
  const list = useExternalStore(highlights.store);
  const nodes = useRef(new Map<string, HTMLElement>());
  const items = useMemo<HighlightItem[]>(() => list.map(entry => ({
    effectId: entry.effectId, text: entry.text ? displayQuestText(entry.text, i18n) : ""
  })), [i18n, list]);
  useEffect(() => {
    if (list.length === 0) return;
    const placed = new Map<string, Placed>();
    let frame = 0;
    const step = () => {
      placeAll(list, nodes.current, placed, highlights.remove);
      frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [highlights, list]);
  const bind = (effectId: string) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(effectId, node);
    else nodes.current.delete(effectId);
  };
  return { bind, items };
};

import { useLingui } from "@lingui/react";
import { type RefObject, useEffect, useMemo, useRef } from "react";

import { translateMessage } from "../../../../shared/i18n/translate";
import { useExternalStore } from "../../../components/external-store";
import { useDialogueMsPerChar } from "../../../settings/dialogue-speed/use-dialogue-speed";
import { PERCENT } from "../constants";
import { letterboxBarHeight } from "../helpers";
import type { CinematicPresentation, CinematicVisualState } from "../presentation";
import { CINEMATIC_UI_MESSAGES as M } from "./messages";

export interface CinematicLayerElements {
  bottom: RefObject<HTMLDivElement | null>;
  fade: RefObject<HTMLDivElement | null>;
  root: RefObject<HTMLDivElement | null>;
  top: RefObject<HTMLDivElement | null>;
}

/** Writes the letterbox and fade amounts straight into the element styles (transform/opacity, no render). */
const applyVisual = (elements: CinematicLayerElements, visual: CinematicVisualState) => {
  const { bottom, fade, top } = elements;
  if (!top.current || !bottom.current || !fade.current) return;
  const hidden = (1 - visual.letterbox) * PERCENT;
  top.current.style.transform = `translateY(${-hidden}%)`;
  bottom.current.style.transform = `translateY(${hidden}%)`;
  fade.current.style.opacity = String(visual.fade);
};

/** The bar height follows the layer size (phone rotation, window resize); read only when the size changes. */
const applyBarHeight = ({ bottom, root, top }: CinematicLayerElements) => {
  if (!root.current || !top.current || !bottom.current) return;
  const height = `${Math.ceil(letterboxBarHeight(root.current.clientWidth, root.current.clientHeight))}px`;
  top.current.style.height = bottom.current.style.height = height;
};

/** Subscribes the layer elements to the per-frame visual channel. */
const useVisualChannel = (presentation: CinematicPresentation, elements: CinematicLayerElements) => {
  useEffect(() => {
    const apply = () => applyVisual(elements, presentation.visual.getSnapshot());
    const resize = () => applyBarHeight(elements);
    resize();
    apply();
    const unsubscribe = presentation.visual.subscribe(apply);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    if (elements.root.current) observer?.observe(elements.root.current);
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, [elements, presentation]);
};

/** The cinematic layer's UI state (speaker page, skip prompt) and its per-frame letterbox/fade binding. */
export const useCinematicUi = (presentation: CinematicPresentation) => {
  const { i18n } = useLingui();
  const ui = useExternalStore(presentation.ui);
  const msPerChar = useDialogueMsPerChar();
  const bottom = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const elements = useMemo<CinematicLayerElements>(() => ({ bottom, fade, root, top }), []);
  useVisualChannel(presentation, elements);
  return {
    bottomRef: bottom,
    fadeRef: fade,
    msPerChar,
    rootRef: root,
    skipLabel: translateMessage(i18n, ui.skipPrompt ? M.skipConfirm : M.skip),
    topRef: top,
    ui
  };
};

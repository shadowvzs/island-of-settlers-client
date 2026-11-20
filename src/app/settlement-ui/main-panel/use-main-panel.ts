import { useLingui } from "@lingui/react";
import { useCallback, useMemo, useRef } from "react";

import { useExternalStore } from "../../components/external-store";
import type { MainPanelVisibilityStore } from "./main-panel";
import { focusMainPanelView, getMainPanelFrame } from "./main-panel-helpers";

/** The main panel frame's prepared values: title, classes, shown view host and its focus on open. */
export const useMainPanel = (panel: MainPanelVisibilityStore) => {
  const { i18n } = useLingui();
  const visibility = useExternalStore(panel);
  const buildRef = useRef<HTMLDivElement>(null);
  const frame = useMemo(() => getMainPanelFrame(visibility, i18n), [i18n, visibility]);
  const focusOnOpen = useCallback((handle: HTMLElement) =>
    focusMainPanelView(visibility.view, buildRef.current, handle), [visibility.view]);
  return { ...frame, buildRef, focusOnOpen, opened: visibility.opened, visible: visibility.visible };
};

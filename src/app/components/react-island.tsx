import { I18nProvider, useLingui } from "@lingui/react";
import { type ComponentType, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { languagePreference } from "../localization/language-store";
import { useI18nRevision } from "./use-i18n-revision";

/** Re-renders every root's content when the active locale changes (DOM-mounted React windows included). */
const LocaleRefresh = ({ children }: { children: ReactNode }) => {
  const { i18n } = useLingui();
  useI18nRevision(i18n);
  return children;
};

/** Mounts React content into an existing DOM element; the game keeps owning the surrounding frame. */
export const mountReactIsland = (container: HTMLElement, content: ReactNode) => {
  const root = createRoot(container);
  root.render(
    <I18nProvider i18n={languagePreference.i18n}>
      <LocaleRefresh>{content}</LocaleRefresh>
    </I18nProvider>
  );
  return () => root.unmount();
};

/**
 * A `createLazyReactContent` mounter of one component with fixed props; each feature keeps its own small mount
 * module, so its view is still a separate lazily loaded chunk.
 */
export const createComponentMount = <P extends object>(component: ComponentType<P>, props: P) =>
  (content: HTMLElement) => mountReactIsland(content, createElement(component, props));

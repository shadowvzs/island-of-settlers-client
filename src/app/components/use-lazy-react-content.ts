import { useEffect, useLayoutEffect, useRef } from "react";

import { createLazyReactContent, type LazyContentTexts, type MountWindowContent } from "./lazy-react-content";

type LazyContent = ReturnType<typeof createLazyReactContent>;

/**
 * Separately bundled React content for the element given the returned ref: it loads the first time `active` is
 * true (its own root, with the loading and failure text of `createLazyReactContent`) and unmounts after this
 * component.
 */
// The generic preserves the concrete element type in the returned React host callback.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export const useLazyReactContent = <T extends HTMLElement>(
  heading: string, active: boolean, load: () => Promise<MountWindowContent>, texts?: LazyContentTexts
) => {
  const contentRef = useRef<LazyContent>(null);
  /** Idempotent: React may call it again with the same host after a render. */
  const hostRef = (host: T | null) => {
    if (host) contentRef.current ??= createLazyReactContent(host, heading, load, texts);
  };
  useLayoutEffect(() => {
    if (active) contentRef.current?.mount();
  }, [active]);
  useEffect(() => () => {
    const content = contentRef.current;
    // Another root must not unmount while this one commits.
    queueMicrotask(() => content?.unmount());
  }, []);
  return hostRef;
};

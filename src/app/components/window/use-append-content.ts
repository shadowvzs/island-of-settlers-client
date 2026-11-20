import { type RefObject, useLayoutEffect } from "react";

/**
 * Appends DOM content another owner renders (an element with its own lazily mounted React root) after the
 * frame's React children; React never renders children after it, so it never competes with that content.
 */
export const useAppendContent = (frameRef: RefObject<HTMLElement | null>, content: HTMLElement | undefined) => {
  useLayoutEffect(() => {
    if (content) frameRef.current!.append(content);
  }, [content, frameRef]);
};

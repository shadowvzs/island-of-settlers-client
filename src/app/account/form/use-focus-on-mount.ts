import { useEffect, useRef } from "react";

/** A ref whose element takes the keyboard focus when the form or panel opens. */
export const useFocusOnMount = <T extends HTMLElement>() => {
  const element = useRef<T>(null);
  useEffect(() => element.current?.focus(), []);
  return element;
};

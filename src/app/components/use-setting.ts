import { useState } from "react";

/** A setting shown by a control: local value plus the caller's apply (store, soundscape, renderer). */
export const useSetting = <T>(initial: T, apply: (value: T) => void) => {
  const [value, setValue] = useState(initial);
  const change = (next: T) => {
    setValue(next);
    apply(next);
  };
  return [value, change] as const;
};

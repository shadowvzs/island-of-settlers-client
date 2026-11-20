import { useState } from "react";

import { getCommandStatus, type KeyedStatus, toKeyedStatus } from "./helpers";

/**
 * A status line that belongs to `key`: it reads empty again once the key changes, without an effect or a
 * remount, and the text of an earlier key never comes back when that key returns.
 */
export const useKeyedStatus = (key: unknown) => {
  const [entry, setEntry] = useState<KeyedStatus>({ key, text: "" });
  const current = toKeyedStatus(entry, key);
  // Render-phase reset, so the status of an earlier visit never comes back.
  if (current !== entry) setEntry(current);
  return {
    setStatus: (text: string) => setEntry({ key, text }),
    status: current.text
  };
};

/** Status line of `true | string` commands (the success text or the refusal reason), keyed like `useKeyedStatus`. */
export const useCommandStatus = (successText: string, resetKey: unknown) => {
  const { setStatus, status } = useKeyedStatus(resetKey);
  return {
    report: (result: true | string) => setStatus(getCommandStatus(result, successText)),
    status
  };
};

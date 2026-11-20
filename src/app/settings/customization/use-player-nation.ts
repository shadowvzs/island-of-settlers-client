import type { MessageDescriptor } from "@lingui/core";
import { useRef, useState } from "react";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { CUSTOMIZATION_MESSAGES as M } from "./messages";

export interface PlayerNationOptions {
  nation: WorkerNation;
  setWorkerNation: (nation: WorkerNation) => Promise<void>;
}

/**
 * Customization nation choice: the helmets stay disabled while the worker loads; a failed load returns
 * to the last loaded nation and says so.
 */
export const usePlayerNation = ({ nation, setWorkerNation }: PlayerNationOptions) => {
  const [selected, setSelected] = useState(nation);
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<MessageDescriptor | null>(null);
  const loaded = useRef(nation);
  const submitting = useRef(false);
  const onSelect = (next: WorkerNation) => {
    if (submitting.current || next === nation) return;
    submitting.current = true;
    setSelected(next);
    setChanging(true);
    setMessage(M.changingNation);
    void setWorkerNation(next)
      .then(() => {
        loaded.current = next;
        setMessage(null);
        return undefined;
      })
      .catch((error: unknown) => {
        setSelected(loaded.current);
        if (error instanceof Error && error.message === "Nation change is awaiting server confirmation")
          setMessage(M.changePending);
        else if (error instanceof Error && error.message === "Nation change confirmed; reload to finish")
          setMessage(M.changeConfirmed);
        else setMessage(M.changeFailed);
      })
      .finally(() => { submitting.current = false; setChanging(false); });
  };
  return { changing, message, selected: changing ? selected : nation, statusHidden: !message, onSelect };
};

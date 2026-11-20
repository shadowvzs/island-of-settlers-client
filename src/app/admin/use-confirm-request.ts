import { useState } from "react";

import type { ConfirmRequest } from "./confirm-request";

/** The open confirmation (one at a time) and the status line its run answered. */
export const useConfirmRequest = () => {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [status, setStatus] = useState("");
  return {
    close: () => setRequest(null),
    finish: (text: string) => {
      setRequest(null);
      setStatus(text);
    },
    open: (next: ConfirmRequest) => {
      setStatus("");
      setRequest(next);
    },
    request,
    status
  };
};

export type ConfirmRequestState = ReturnType<typeof useConfirmRequest>;

import { useLingui } from "@lingui/react";
import { useEffect, useState } from "react";

import { useExternalStore } from "../components/external-store";
import type { ReadableStore } from "../components/ui-store";
import type { CloudSaveStatus } from "../save-store/remote-save-store";
import { getCloudStatusView } from "./helpers";

/** The indicator's line; while offline it counts down to the next retry once a second. */
export const useCloudStatus = (status: ReadableStore<CloudSaveStatus | null>) => {
  const { i18n } = useLingui();
  const current = useExternalStore(status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (current?.kind !== "offline") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [current]);
  return getCloudStatusView(current, now, i18n);
};

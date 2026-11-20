import { useCallback, useEffect, useState } from "react";

import { errorText } from "../helpers";
import type {
  AuditEntry, CampaignSummary, MaintenanceCapabilities, MaintenancePort, StarterHistory
} from "./maintenance-ports";

export interface MaintenanceData {
  audit: AuditEntry[];
  campaigns: CampaignSummary[];
  capabilities: MaintenanceCapabilities | null;
  error: string;
  globalWinter: boolean | null;
  starter: StarterHistory | null;
}

const EMPTY: MaintenanceData = {
  audit: [], campaigns: [], capabilities: null, error: "", globalWinter: null, starter: null
};

/** A failed part answers its empty value and adds its message; the other parts still show. */
const settle = async <T>(work: Promise<T>, empty: T, errors: string[]) => {
  try {
    return await work;
  } catch (failure) {
    errors.push(errorText(failure));
    return empty;
  }
};

const fetchMaintenanceData = async (port: MaintenancePort): Promise<MaintenanceData> => {
  const errors: string[] = [];
  const [capabilities, audit, campaigns, starter, globalWinter] = await Promise.all([
    settle<MaintenanceCapabilities | null>(port.capabilities(), null, errors),
    settle(port.auditLog(), [], errors),
    settle(port.campaigns(), [], errors),
    settle<StarterHistory | null>(port.starterHistory(), null, errors),
    settle<boolean | null>(port.globalWinter(), null, errors)
  ]);
  return { audit, campaigns, capabilities, error: errors.join(" · "), globalWinter, starter };
};

/** The server side of the tab, loaded together; `reload` after every action refreshes the audit and lists. */
export const useMaintenanceData = (port: MaintenancePort | null) => {
  const [data, setData] = useState<MaintenanceData>(EMPTY);

  useEffect(() => {
    if (!port) return undefined;
    let live = true;
    const run = async () => {
      const next = await fetchMaintenanceData(port);
      if (live) setData(next);
    };
    void run();
    return () => { live = false; };
  }, [port]);

  const reload = useCallback(async () => {
    if (port) setData(await fetchMaintenanceData(port));
  }, [port]);

  return { data, reload };
};

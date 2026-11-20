import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import type { SettlementBuildingSummary } from "../types";
import { UpgradeConfirmation } from "./upgrade-confirmation";
import { getUpgradeView } from "./upgrade-helpers";

interface WorkshopUpgradeProps {
  building: SettlementBuildingSummary;
  visible: boolean;
  onUpgrade: (cancel: boolean) => boolean | void;
}
/** The paid action and its complete delivery/builder information live in a separate confirmation. */
export const WorkshopUpgrade = ({ building, visible, onUpgrade }: WorkshopUpgradeProps) => {
  const { i18n } = useLingui();
  const view = useMemo(() => getUpgradeView(building, i18n), [building, i18n]);
  return (
    <UpgradeConfirmation id={building.id} subject="workshop-upgrade" view={view} visible={visible}
      onUpgrade={onUpgrade} />
  );
};

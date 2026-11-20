import { useMemo } from "react";

import { IconButton } from "../components/icon-button";
import { getObservationLaunchers, type ObservationPickKind } from "./helpers";

interface ObservationLaunchersProps {
  onWatch: (kind: ObservationPickKind) => void;
}
/** Watch worker / Watch ship in the camera panel: each opens the Observe window in picking mode. */
export const ObservationLaunchers = ({ onWatch }: ObservationLaunchersProps) => {
  const launchers = useMemo(() => getObservationLaunchers(onWatch), [onWatch]);
  return (
    <div className="camera-observation-controls">
      <div className="camera-control-row">
        {launchers.map(({ caption, icon, kind, label, onClick }) => (
          <IconButton caption={caption} icon={icon} key={kind} label={label} onClick={onClick} />
        ))}
      </div>
    </div>
  );
};

import { useLingui } from "@lingui/react";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { RacePicker } from "../../account/race-picker/race-picker";
import { usePlayerAvatarSelection } from "../../player-avatar/use-player-avatar";
import { CUSTOMIZATION_MESSAGES as M } from "../customization/messages";
import { usePlayerNation } from "../customization/use-player-nation";

interface PlayerNationControlProps {
  onNationChange: (nation: WorkerNation) => Promise<void>;
}

/** Development and Customization share the same nation owner, loading and failure handling. */
export const PlayerNationControl = ({ onNationChange }: PlayerNationControlProps) => {
  const { i18n } = useLingui();
  const { nation } = usePlayerAvatarSelection();
  const choice = usePlayerNation({ nation, setWorkerNation: onNationChange });
  let status = "";
  if (choice.message) status = i18n._(choice.message);
  return (
    <>
      <div className="settings-panel__nation">
        <span>{i18n._(M.nation)}</span>
        <RacePicker disabled={choice.changing} label={i18n._(M.nation)} selected={choice.selected}
          size="compact" onSelect={choice.onSelect} />
      </div>
      <p className="settings-panel__hint" hidden={choice.statusHidden} role="status">{status}</p>
    </>
  );
};

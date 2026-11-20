import { RewardIcons } from "../../../settlement-ui/reward-icons/reward-icons";
import { ScriptIconButton } from "../icon-button";
import type { RewardLineView } from "./use-quest-rewards";

interface RewardLineProps {
  editLabel: string;
  line: RewardLineView;
  nothing: string;
}
/** A cost or reward line: its title, the shared reward icons (or "nothing") and the edit button (RewardPicker). */
export const RewardLine = ({ editLabel, line, nothing }: RewardLineProps) => (
  <div className="script-quest__reward">
    <span className="script-variable__label">{line.title}</span>
    {line.empty && <span className="script-form__note">{nothing}</span>}
    {!line.empty && <RewardIcons view={line.icons} />}
    <ScriptIconButton icon="edit" label={editLabel} onClick={line.onEdit} />
  </div>
);

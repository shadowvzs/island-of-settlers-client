import type { RewardIconArt } from "../../settlement-ui/reward-icons/helpers";
import { RewardPicture } from "../../settlement-ui/reward-icons/reward-icons";

/** One choosable option of a picker grid (reward picker, catalog picker): picture, name, pressed state. */
export interface OptionGridItem {
  /** A small second picture in the corner (a settler's tool); absent: none. */
  badge?: RewardIconArt | null;
  /** Null: no picture (the first letter of the name is shown instead). */
  icon: RewardIconArt | null;
  /** The name's first letter, shown when there is no picture. */
  initial: string;
  key: string;
  label: string;
  selected: boolean;
}

interface OptionPictureProps {
  option: OptionGridItem;
}
const OptionPicture = ({ option }: OptionPictureProps) => {
  if (!option.icon) return <span aria-hidden="true" className="reward-picker__initial">{option.initial}</span>;
  return <RewardPicture icon={option.icon} label={option.label} />;
};

interface OptionGridProps {
  noMatches: string;
  options: readonly OptionGridItem[];
  onPick: (key: string) => void;
}
/** The shared option grid of the reward picker and the script catalog picker (one button per option). */
export const OptionGrid = ({ noMatches, options, onPick }: OptionGridProps) => (
  <>
    {noMatches && <p className="reward-picker__hint">{noMatches}</p>}
    <ul className="reward-picker__grid">
      {options.map(option => (
        <li key={option.key}>
          <button aria-pressed={option.selected} className="reward-picker__option" title={option.label}
            type="button" onClick={() => onPick(option.key)}>
            <span className="reward-picker__picture">
              <OptionPicture option={option} />
              {option.badge && <span className="reward-picker__badge">
                <RewardPicture icon={option.badge} label={option.label} /></span>}
            </span>
            <span className="reward-picker__name">{option.label}</span>
          </button>
        </li>
      ))}
    </ul>
  </>
);

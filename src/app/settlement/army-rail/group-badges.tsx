import type { ArmyRailView } from "./helpers";

interface GroupBadgesProps {
  groups: ArmyRailView["groups"];
  heading: string;
  hidden: boolean;
  onRecall: (digit: number) => void;
}
/** Control-group badges ("1·5"): a click (or tap) recalls the group, as its digit key does. */
export const GroupBadges = ({ groups, heading, hidden, onRecall }: GroupBadgesProps) => (
  <div aria-label={heading} className="army-action-rail__groups" hidden={hidden} role="group">
    {groups.map(({ digit, label, text }) => (
      <button aria-label={label} className="army-action-rail__group settlement-ui__button" key={digit} title={label}
        type="button" onClick={() => onRecall(digit)}>
        {text}
      </button>
    ))}
  </div>
);

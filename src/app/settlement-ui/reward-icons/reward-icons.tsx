import { BuildingIcon } from "../../components/building-icon";
import { joinClassNames } from "../../components/helpers";
import { WareIcon } from "../../components/ware-icon";
import type { RewardIconArt, RewardIconsView } from "./helpers";

import "./reward-icons.css";

interface RewardPictureProps {
  icon: RewardIconArt;
  label: string;
}
/** The picture of one reward (shared with the reward picker's option grid). */
export const RewardPicture = ({ icon, label }: RewardPictureProps) => {
  if (icon.kind === "ware") return <WareIcon title={label} ware={icon.ware} />;
  if (icon.kind === "building") return <BuildingIcon type={icon.type} />;
  return (
    <img alt="" aria-hidden="true" data-crop={icon.crop} decoding="async" draggable={false} src={icon.source} />
  );
};

interface RewardIconsProps {
  className?: string;
  view: RewardIconsView;
}
/**
 * The shared reward row: the experience badge, then one pill of fixed-size reward icons with counts (name as the
 * tooltip) and a "+N more" chip naming what did not fit.
 */
export const RewardIcons = ({ className, view }: RewardIconsProps) => (
  <div aria-label={view.label} className={joinClassNames("reward-icons", className)} role="group">
    {view.experience && (
      <span className="reward-icons__experience">
        <img alt="" aria-hidden="true" draggable={false} src={view.experience.icon} />
        <span>{view.experience.text}</span>
      </span>
    )}
    {view.items.length > 0 && (
      <ul className="reward-icons__items">
        {view.items.map(item => (
          <li aria-label={item.ariaLabel} className="reward-icons__item" key={item.key} title={item.label}>
            <RewardPicture icon={item.icon} label={item.label} />
            {item.count && <span>{item.count}</span>}
          </li>
        ))}
        {view.overflow && (
          <li aria-label={view.overflow.ariaLabel} className="reward-icons__item reward-icons__more"
            title={view.overflow.label}>
            {view.overflow.text}
          </li>
        )}
      </ul>
    )}
  </div>
);

import { resolveSettlementIcon } from "../settlement-ui/icons";
import { joinClassNames } from "./helpers";

interface PictureProps {
  className: string;
  source: string;
}
const Picture = ({ className, source }: PictureProps) => (
  <img alt="" aria-hidden="true" className={className} draggable={false} src={source} />
);

const BASE_CLASS_NAME = "settlement-art-icon";

interface SettlementIconProps {
  /** Extra class of the icon (e.g. `settings__icon-image` in the corner buttons). */
  className?: string;
  name: string;
}
/** A named HUD icon (`resolveSettlementIcon`): a picture, a pre-rendered 3D image or the sail-back pair. */
export const SettlementIcon = ({ className, name }: SettlementIconProps) => {
  const icon = resolveSettlementIcon(name);
  const iconClassName = joinClassNames(BASE_CLASS_NAME, className);
  if (icon.kind === "picture") return <Picture className={iconClassName} source={icon.source} />;
  if (icon.kind === "sailBack") {
    return (
      <span aria-hidden="true" className="settlement-sail-back-icon">
        <Picture className={BASE_CLASS_NAME} source={icon.back} />
        <Picture className={BASE_CLASS_NAME} source={icon.ship} />
      </span>
    );
  }
  return (
    <svg aria-hidden="true" className={iconClassName} data-icon={name} focusable="false" viewBox="0 0 24 24">
      <image height="24" href={icon.source} width="24" />
    </svg>
  );
};

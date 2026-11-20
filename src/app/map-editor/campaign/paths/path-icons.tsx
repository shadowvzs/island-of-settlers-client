import { PATH_ICON_SHAPES } from "./constants";

export type PathIconName = keyof typeof PATH_ICON_SHAPES;

interface PathIconProps {
  name: PathIconName;
}
/** One stroke icon of the campaign path controls (24 px box; colour from the button). */
export const PathIcon = ({ name }: PathIconProps) => (
  <svg aria-hidden="true" className="campaign-paths__icon" focusable="false" viewBox="0 0 24 24">
    <path d={PATH_ICON_SHAPES[name]} />
  </svg>
);

import { getHelmetUrl } from "../account/race-picker/helpers";

import "./inventory.css";

/** Four owned, shaded helmet artworks compose the one consumable icon. */
export const ChooseNationIcon = () => (
  <span aria-hidden="true" className="choose-nation-icon">
    <img alt="" draggable={false} src={getHelmetUrl("roman")} />
    <img alt="" draggable={false} src={getHelmetUrl("viking")} />
    <img alt="" draggable={false} src={getHelmetUrl("chinese")} />
    <img alt="" draggable={false} src={getHelmetUrl("maya")} />
  </span>
);

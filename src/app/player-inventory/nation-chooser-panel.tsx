import { RacePicker } from "../account/race-picker/race-picker";
import { INVENTORY_MESSAGES as M } from "./messages";
import { type NationChooserOptions, useNationChooser } from "./use-nation-chooser";

export type { NationChooserOptions } from "./use-nation-chooser";

export const NationChooserPanel = ({ onClose, ...options }:NationChooserOptions) => {
  const { i18n, nation, inventory, selected, changing, status, setSelected, confirm } = useNationChooser({ ...options,onClose });
  return (
    <div className="nation-chooser">
      <p className="settings-panel__hint">{i18n._(M.description)}</p>
      <RacePicker disabled={changing || !inventory.chooseNation} disabledNation={nation}
        label={i18n._(M.chooseNation)} selected={selected} size="large" onSelect={setSelected} />
      <p hidden={!status} role="status">{status}</p>
      <div className="nation-chooser__actions">
        <button className="settlement-ui__button" disabled={changing} type="button" onClick={onClose}>{i18n._(M.cancel)}</button>
        <button className="settlement-ui__button" disabled={changing || !selected || selected === nation || !inventory.chooseNation}
          type="button" onClick={confirm}>{i18n._(M.confirm)}</button>
      </div>
    </div>
  );
};

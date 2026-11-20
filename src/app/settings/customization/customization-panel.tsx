import { useLingui } from "@lingui/react";
import type { KeyboardEvent } from "react";

import type { PlayerAvatarGender } from "../../../render-common/workers/player-avatar";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { RacePicker } from "../../account/race-picker/race-picker";
import { useExternalStore } from "../../components/external-store";
import { InlineInfo } from "../../components/info-hint";
import { usePlayerAvatarSelection } from "../../player-avatar/use-player-avatar";
import { INVENTORY_MESSAGES } from "../../player-inventory/messages";
import { playerInventoryView } from "../../player-inventory/store";
import type { AvatarGenderOption } from "./helpers";
import { CUSTOMIZATION_MESSAGES as M } from "./messages";
import { useAvatarGender } from "./use-avatar-gender";
import { usePlayerNation } from "./use-player-nation";

import "./customization.css";

interface GenderRadiosProps {
  changing: boolean;
  options: AvatarGenderOption[];
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onSelect: (gender: PlayerAvatarGender) => void;
  registerButton: (index: number) => (button: HTMLButtonElement | null) => void;
}

/** The two cropped faces as a native-feeling radio group with roving focus and tooltips. */
const GenderRadios = ({ changing, options, onKeyDown, onSelect, registerButton }: GenderRadiosProps) => (
  <div aria-labelledby="customization-gender-label" className="customization__gender-options" role="radiogroup">
    {options.map(option => (
      <button
        aria-checked={option.checked}
        aria-label={option.label}
        className="settlement-ui__button customization__gender-option"
        data-gender={option.gender}
        disabled={changing}
        key={option.gender}
        ref={registerButton(option.index)}
        role="radio"
        tabIndex={option.tabIndex}
        title={option.title}
        type="button"
        onClick={() => onSelect(option.gender)}
        onKeyDown={event => onKeyDown(event, option.index)}
      >
        <img alt="" className="customization__face" draggable={false} src={option.face} />
        <span>{option.shortLabel}</span>
      </button>
    ))}
  </div>
);

interface CustomizationPanelViewProps {
  changingGender: boolean;
  changingNation: boolean;
  genderOptions: AvatarGenderOption[];
  genderStatus: string;
  nation: WorkerNation;
  nationStatus: string;
  nationLocked?: boolean;
  onGenderKey: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onGenderSelect: (gender: PlayerAvatarGender) => void;
  onNationSelect: (nation: WorkerNation) => void;
  registerGenderButton: (index: number) => (button: HTMLButtonElement | null) => void;
}

/** Presentational customization body: nation avatar helmets and the male/female face radios. */
export const CustomizationPanelView = ({
  changingGender,
  changingNation,
  genderOptions,
  genderStatus,
  nation,
  nationStatus,
  nationLocked,
  onGenderKey,
  onGenderSelect,
  onNationSelect,
  registerGenderButton
}: CustomizationPanelViewProps) => {
  const { i18n } = useLingui();
  return (
    <div className="customization">
      <section className="customization__section">
        <span className="customization__label-row">
          <span className="customization__label">{i18n._(M.avatar)}</span>
          <InlineInfo info={{ label: i18n._(M.avatar), text: i18n._(M.help) }} />
        </span>
        <span className="customization__sub-label">{i18n._(M.nation)}</span>
        <RacePicker
          disabled={changingNation || nationLocked}
          label={i18n._(M.nation)}
          selected={nation}
          size="large"
          onSelect={onNationSelect}
        />
        {nationLocked && <p className="settings-panel__hint">{i18n._(INVENTORY_MESSAGES.locked)}</p>}
        <p className="settings-panel__hint" hidden={!nationStatus} role="status">{nationStatus}</p>
      </section>
      <section className="customization__section">
        <span className="customization__label" id="customization-gender-label">
          {i18n._(M.gender)}
        </span>
        <GenderRadios
          changing={changingGender}
          options={genderOptions}
          registerButton={registerGenderButton}
          onKeyDown={onGenderKey}
          onSelect={onGenderSelect}
        />
        <p className="settings-panel__hint" hidden={!genderStatus} role="status">{genderStatus}</p>
      </section>
    </div>
  );
};

export interface CustomizationOptions {
  setNation: (nation: WorkerNation) => Promise<void>;
}

/** Connected customization body; the window frame owns visibility and lazy loading. */
export const CustomizationPanel = ({ setNation }: CustomizationOptions) => {
  const { i18n } = useLingui();
  const { nation } = usePlayerAvatarSelection();
  const inventory = useExternalStore(playerInventoryView);
  const nationChoice = usePlayerNation({ nation, setWorkerNation: setNation });
  const genderChoice = useAvatarGender(nation);
  let nationStatus = "";
  let genderStatus = "";
  if (nationChoice.message) nationStatus = i18n._(nationChoice.message);
  if (genderChoice.message) genderStatus = i18n._(genderChoice.message);
  return (
    <CustomizationPanelView
      changingGender={genderChoice.changing}
      changingNation={nationChoice.changing}
      genderOptions={genderChoice.options}
      genderStatus={genderStatus}
      nation={nationChoice.selected}
      nationLocked={!inventory.chooseNation}
      nationStatus={nationStatus}
      registerGenderButton={genderChoice.registerButton}
      onGenderKey={genderChoice.onKeyDown}
      onGenderSelect={genderChoice.choose}
      onNationSelect={nationChoice.onSelect}
    />
  );
};

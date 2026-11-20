import { useLingui } from "@lingui/react";
import type { ReactNode } from "react";

import type { ExternalStore } from "../../components/external-store";
import { IconButton } from "../../components/icon-button";
import { Inventory } from "../../components/inventory";
import { SettlementIcon } from "../../components/settlement-icon";
import { ArtImage } from "../art-image";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { ShipPassengerCell, ShipPreviewButton, ShipRegisterState, ShipRegisterView } from "./helpers";
import type { ShipRegisterActions } from "./ship-register-window";
import { ShipTroopSection } from "./troop-section";
import { useShipRegister } from "./use-ship-register";

interface PassengerIconProps {
  className: string;
  icon?: string;
}
const PassengerIcon = ({ className, icon }: PassengerIconProps) => {
  if (!icon) return <SettlementIcon className={className} name="people" />;
  return <img alt="" className={className} draggable={false} src={icon} />;
};

interface PassengersProps {
  cells: readonly ShipPassengerCell[];
}
/** Soldiers show their military unit icon per troop type; civilians keep the settlers icon. */
const Passengers = ({ cells }: PassengersProps) => {
  const { i18n } = useLingui();
  return (
  <section aria-label={i18n._(M.shipRegister.passengers)}>
    <h3>{i18n._(M.shipRegister.passengers)}</h3>
    <div className="settlement-ui__inventory-grid">
      {cells.map(cell => (
        <div aria-label={cell.title} data-count={cell.count} data-job={cell.job} key={cell.job} title={cell.title}>
          <PassengerIcon className={cell.iconClassName} icon={cell.icon} />
          <small>{cell.label}</small>
          <b>{cell.count}</b>
        </div>
      ))}
    </div>
    {cells.length === 0 && <p>{i18n._(M.shipRegister.noPassengers)}</p>}
  </section>
  );
};

interface RegisterButtonProps {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  pressed?: boolean;
  title?: string;
  onClick: () => void;
}
/** A settlement button whose picture is not a settlement icon (go-to-place, camera badge). */
const RegisterButton = ({ children, disabled, label, pressed, title, onClick }: RegisterButtonProps) => (
  <button
    aria-label={label}
    aria-pressed={pressed}
    className="settlement-ui__button"
    disabled={disabled}
    title={title ?? label}
    type="button"
    onClick={onClick}
  >
    {children}
  </button>
);

interface PreviewProps {
  buttons: readonly ShipPreviewButton[];
  open: boolean;
  onToggle: ShipRegisterActions["togglePreview"];
}
const DeckPreview = ({ buttons, open, onToggle }: PreviewProps) => {
  const { i18n } = useLingui();
  return (
  <details open={open}>
    <summary>{i18n._(M.shipRegister.debugPreview)}</summary>
    <p>{i18n._(M.shipRegister.debugNote)}</p>
    <div className="settlement-ui__building-actions">
      {buttons.map(button => (
        <RegisterButton
          disabled={button.disabled}
          key={button.kind}
          label={button.label}
          pressed={button.pressed}
          title={button.title}
          onClick={() => onToggle(button.kind)}
        >
          <SettlementIcon name={button.icon} />
        </RegisterButton>
      ))}
    </div>
  </details>
  );
};

interface ShipControlsProps {
  actions: ShipRegisterActions;
  view: ShipRegisterView;
}
const ShipControls = ({ actions, view }: ShipControlsProps) => {
  const { i18n } = useLingui();
  return (
  <div className="settlement-ui__building-actions">
    {view.navigation && <>
    <IconButton caption={i18n._(M.shipRegister.previous)} disabled={view.previousDisabled} icon="ship"
      label={i18n._(M.shipRegister.previous)} onClick={() => actions.step(-1)} />
    <IconButton caption={i18n._(M.shipRegister.next)} disabled={view.nextDisabled} icon="ship"
      label={i18n._(M.shipRegister.next)} onClick={() => actions.step(1)} />
    </>}
    <RegisterButton disabled={view.locateDisabled} label={i18n._(M.shipRegister.goToPlace)}
      onClick={actions.locate}>
      <img alt="" src={view.goToPlaceIcon} />
      <span>{i18n._(M.shipRegister.goToPlace)}</span>
    </RegisterButton>
    {actions.sink && view.navigation && <IconButton caption={i18n._(M.shipRegister.sinkCaption)}
      data={{ "data-sink-ship": "" }} disabled={!view.canSink} icon="demolish" label={i18n._(M.shipRegister.sink)}
      title={i18n._(M.shipRegister.sinkHint)} onClick={actions.sink} />}
    {view.follow && <IconButton caption={i18n._(M.shipRegister.followCaption)} className="settlement-ui__ship-follow"
      data={{ "data-follow-ship": "" }} disabled={view.follow.disabled} icon="ship" label={view.follow.label}
      pressed={view.follow.pressed} onClick={actions.toggleFollow} />}
  </div>
  );
};

interface ShipRegisterViewProps {
  actions: ShipRegisterActions;
  view: ShipRegisterView | null;
}
const ShipRegisterContent = ({ actions, view }: ShipRegisterViewProps) => {
  const { i18n } = useLingui();
  if (!view) return <p>{i18n._(M.shipRegister.noShips)}</p>;
  return (
    <>
      <h3>{view.name}</h3>
      {view.reliefMission && <p data-relief-quest="">{view.reliefMission}</p>}
      <p>{view.status}</p>
      <p data-ship-journey="">{view.journey}</p>
      <ArtImage art={view.portrait} />
      <Inventory heading={i18n._(M.shipRegister.cargo)} inventory={view.wares} />
      <Passengers cells={view.passengers} />
      {view.troops && <ShipTroopSection view={view.troops} onAction={actions.troops} />}
      <ShipControls actions={actions} view={view} />
      {view.preview && (
        <DeckPreview buttons={view.preview.buttons} open={view.preview.open} onToggle={actions.togglePreview} />
      )}
    </>
  );
};

interface ShipRegisterProps {
  actions: ShipRegisterActions;
  store: ExternalStore<ShipRegisterState>;
}
/** Ship register content: name, position, journey, cargo, passengers, navigation, follow and preview. */
export const ShipRegister = ({ actions, store }: ShipRegisterProps) => (
  <ShipRegisterContent actions={actions} view={useShipRegister(store)} />
);

import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { SettlementIcon } from "../../components/settlement-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { FleetShipRow } from "./helpers";
import type { FleetCargoView } from "./use-fleet-cargo";
import type { NavalPassengersView } from "./use-naval-passengers";

interface ChoiceSelectProps {
  choices: readonly { label: string; value: string }[];
  label: string;
  value: string;
  onChange: (value: string) => void;
}
const ChoiceSelect = ({ choices, label, value, onChange }: ChoiceSelectProps) => (
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
  </select>
);

interface CargoFormProps {
  cargo: FleetCargoView;
}
/** Harbour-to-harbour cargo order. */
export const CargoForm = ({ cargo }: CargoFormProps) => {
  const { i18n } = useLingui();
  const queueCargo = i18n._(M.fleet.queueCargo);
  return (
  <form className="settlement-ui__cargo-controls" onSubmit={cargo.onSubmit}>
    <ChoiceSelect choices={cargo.harbours} label={i18n._(M.fleet.source)} value={cargo.source}
      onChange={cargo.onSource} />
    <ChoiceSelect choices={cargo.harbours} label={i18n._(M.fleet.destination)} value={cargo.destination}
      onChange={cargo.onDestination} />
    <ChoiceSelect choices={cargo.wares} label={i18n._(M.fleet.ware)} value={cargo.ware} onChange={cargo.onWare} />
    <input aria-label={i18n._(M.fleet.quantity)} max={40} min={1} type="number" value={cargo.quantity}
      onChange={event => cargo.onQuantity(event.target.value)} />
    <button aria-label={queueCargo} className="settlement-ui__button" title={queueCargo} type="submit">
      <SettlementIcon name="ship" />
      <span>{queueCargo}</span>
    </button>
    <small role="status">{cargo.status}</small>
  </form>
  );
};

interface ShoreControlsProps {
  blocked?: string;
  passengers: NavalPassengersView;
}
const ShoreControls = ({ blocked, passengers }: ShoreControlsProps) => {
  const { i18n } = useLingui();
  return (
    <>
      <IconButton caption={i18n._(M.fleet.findShore)} icon="map" label={i18n._(M.fleet.findShore)}
        onClick={passengers.onFindShores} />
      <ChoiceSelect choices={passengers.shores} label={i18n._(M.fleet.expeditionShore)} value={passengers.shore}
        onChange={passengers.onShore} />
      <IconButton caption={i18n._(M.fleet.foundHarbour)} disabled={Boolean(blocked)} icon="build"
        label={i18n._(M.fleet.foundHarbour)} title={blocked} onClick={passengers.onFound} />
    </>
  );
};

interface PassengerControlsProps {
  passengers: NavalPassengersView;
  /** Founding refused here (the map narrows settlement expeditions): the reason. */
  shoreBlocked?: string;
  shores: boolean;
}
/** Passenger voyages, cancels of queued sea orders and (when offered) a settlement expedition. */
export const PassengerControls = ({ passengers, shoreBlocked, shores }: PassengerControlsProps) => {
  const { i18n } = useLingui();
  return (
  <section className="settlement-ui__cargo-controls">
    <ChoiceSelect choices={passengers.harbours} label={i18n._(M.fleet.passengerSource)} value={passengers.source}
      onChange={passengers.onSource} />
    <ChoiceSelect choices={passengers.harbours} label={i18n._(M.fleet.passengerDestination)}
      value={passengers.destination} onChange={passengers.onDestination} />
    <label>
      {i18n._(M.fleet.settlers)}{" "}
      <input aria-label={i18n._(M.fleet.settlerPassengers)} max={40} min={0} type="number"
        value={passengers.settlers}
        onChange={event => passengers.onSettlers(event.target.value)} />
    </label>
    <label>
      {i18n._(M.fleet.reserveSoldiers)}{" "}
      <input aria-label={i18n._(M.fleet.reserveSoldierPassengers)} max={40} min={0} type="number"
        value={passengers.soldiers} onChange={event => passengers.onSoldiers(event.target.value)} />
    </label>
    <IconButton caption={i18n._(M.fleet.sendPassengers)} icon="people"
      label={i18n._(M.fleet.sendPassengers)} onClick={passengers.onSend} />
    <small role="status">{passengers.status}</small>
    {passengers.orders.map(order => (
      <IconButton caption={order.label} icon="cancel" key={order.id} label={order.label}
        onClick={() => passengers.onCancelOrder(order.id)} />
    ))}
    {shores && <ShoreControls blocked={shoreBlocked} passengers={passengers} />}
  </section>
  );
};

interface ShipRowProps {
  focusable: boolean;
  ship: FleetShipRow;
  onFocusShip: (id: string) => void;
}
const ShipRow = ({ focusable, ship, onFocusShip }: ShipRowProps) => {
  const text = (
    <>
      <SettlementIcon name="ship" />
      <span><b>{ship.name}</b><small>{ship.detail}</small></span>
    </>
  );
  if (!focusable) return <div className="settlement-ui__overview-row" data-ship-id={ship.id}>{text}</div>;
  return (
    <button className="settlement-ui__overview-row" data-ship-id={ship.id} type="button"
      onClick={() => onFocusShip(ship.id)}>
      {text}
    </button>
  );
};

interface ShipRowsProps {
  focusable: boolean;
  ships: readonly FleetShipRow[];
  onFocusShip: (id: string) => void;
}
/** Fleet rows; each opens the ship register on its ship. */
export const ShipRows = ({ focusable, ships, onFocusShip }: ShipRowsProps) => (
  <>
    {ships.map(ship => <ShipRow focusable={focusable} key={ship.id} ship={ship} onFocusShip={onFocusShip} />)}
  </>
);

import { useLingui } from "@lingui/react";

import { SettlementIcon } from "../../components/settlement-icon";
import { ArtImage } from "../art-image";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { ColonyRowAction, ColonyRowView, getIncomingShips } from "./colony-list-helpers";

interface RowActionProps {
  action: ColonyRowAction;
}
/** Icon-only row button; the label is its accessible name and tooltip. */
const RowAction = ({ action }: RowActionProps) => (
  <button
    aria-current={action.current}
    aria-label={action.label}
    className={`settlement-ui__button ${action.className}`}
    disabled={action.disabled}
    title={action.label}
    type="button"
    onClick={action.onSelect}
    {...action.data}
  >
    <SettlementIcon name={action.icon} />
  </button>
);

interface IncomingShipsProps {
  ships: ReturnType<typeof getIncomingShips>;
}
const IncomingShips = ({ ships }: IncomingShipsProps) => {
  const { i18n } = useLingui();
  return (
  <div aria-label={i18n._(M.colony.incomingAria)} className="colony-tracker__incoming">
    {ships.map(ship => (
      <section className="colony-tracker__ship-bubble" data-incoming-ship={ship.id} key={ship.id}>
        <strong><SettlementIcon name="ship" />{ship.name}</strong>
        <small>{ship.eta}</small>
        <div className="colony-tracker__ship-cargo">
          {ship.cargo.map(item => (
            <span aria-label={item.label} key={item.label} title={item.label}>
              <ArtImage art={item.art} />
              {item.count}
            </span>
          ))}
        </div>
      </section>
    ))}
  </div>
  );
};

interface ColonyRowProps {
  row: ColonyRowView;
}
const ColonyRow = ({ row }: ColonyRowProps) => (
  <article className="colony-tracker__colony">
    <span aria-hidden="true" className="colony-tracker__island-art"><ArtImage art={row.art} /></span>
    <span className="colony-tracker__text">
      <strong>{row.title}</strong>
      <small>{row.detail}</small>
    </span>
    {row.actions.map(action => <RowAction action={action} key={action.key} />)}
    {row.schedule && (
      <small className="colony-tracker__ship-schedule" title={row.schedule.title}>{row.schedule.text}</small>
    )}
    {row.incoming.length > 0 && <IncomingShips ships={row.incoming} />}
  </article>
);

interface ColonyListProps {
  rows: readonly ColonyRowView[];
}
/** Colonies, adventures and the way home; absent while nothing is listed. */
export const ColonyList = ({ rows }: ColonyListProps) => {
  const { i18n } = useLingui();
  if (!rows.length) return null;
  return (
    <section aria-label={i18n._(M.colony.coloniesAria)} className="colony-tracker__colonies">
      {rows.map(row => <ColonyRow key={row.key} row={row} />)}
    </section>
  );
};

import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { SETTLEMENT_MESSAGES as M } from "../messages";
import { RankChevrons } from "../rank-chevrons";
import type { SettlementSoldierDetails } from "../types";
import {
  getSoldierGroups, getSoldierRow, getStoredSoldierTotal, type SoldierGroup, type SoldierRow
} from "./soldier-helpers";

interface SoldierRowViewProps {
  row: SoldierRow;
}
const SoldierRowView = ({ row }: SoldierRowViewProps) => (
  <div className="settlement-ui__soldier-row" data-rank={row.rank}>
    <span className="settlement-ui__soldier-portrait">
      <img alt="" draggable={false} loading="eager" src={row.icon} />
      <RankChevrons level={row.rank + 1} />
    </span>
    <span>{row.detail}</span>
  </div>
);

interface SoldierGroupViewProps {
  group: SoldierGroup;
}
const SoldierGroupView = ({ group }: SoldierGroupViewProps) => (
  <div
    aria-label={group.title}
    className="settlement-ui__soldier-group"
    data-count={group.count}
    data-rank={group.rank}
    data-troop={group.type}
    data-wounded={group.wounded}
    title={group.title}
  >
    <span className="settlement-ui__soldier-portrait">
      <img alt="" draggable={false} loading="eager" src={group.icon} />
      <RankChevrons level={group.rank + 1} />
    </span>
    <small>{group.label}</small>
    <b>{group.count}</b>
    {group.woundedText && <small className="settlement-ui__soldier-wounded">{group.woundedText}</small>}
  </div>
);

interface SoldierRosterProps {
  nation: string;
  soldiers: readonly SettlementSoldierDetails[];
}
/** Individual assigned soldiers with their fixed rank, HP and status; no equipment controls. */
export const SoldierDetailList = ({ nation, soldiers }: SoldierRosterProps) => {
  const { i18n } = useLingui();
  const rows = useMemo(() => soldiers.map(soldier => getSoldierRow(soldier, nation, i18n)),
    [i18n, nation, soldiers]);
  return (
    <section aria-label={i18n._(M.details.soldiers.aria)} className="settlement-ui__soldier-roster">
      <h3>{i18n._(M.details.soldiers.heading)}</h3>
      {rows.length > 0 && <div>{rows.map(row => <SoldierRowView key={row.actor} row={row} />)}</div>}
      {rows.length === 0 && (
        <p className="settlement-ui__section-description">{i18n._(M.details.soldiers.emptyDetails)}</p>
      )}
    </section>
  );
};

/** Stored reserves grouped by fixed troop type and rank in the storage pages' icon-grid layout. */
export const SoldierStorageRoster = ({ nation, soldiers }: SoldierRosterProps) => {
  const { i18n } = useLingui();
  const groups = useMemo(() => getSoldierGroups(soldiers, nation, i18n), [i18n, nation, soldiers]);
  const total = useMemo(() => getStoredSoldierTotal(soldiers, i18n), [i18n, soldiers]);
  return (
    <section
      aria-label={i18n._(M.details.soldiers.aria)}
      className="settlement-ui__inventory settlement-ui__soldier-inventory"
    >
      <h3>{i18n._(M.details.soldiers.heading)}</h3>
      <p className="settlement-ui__section-description">{total}</p>
      <p className="settlement-ui__section-description">{i18n._(M.details.soldiers.storageNote)}</p>
      {groups.length > 0 && (
        <div className="settlement-ui__inventory-grid">
          {groups.map(group => <SoldierGroupView group={group} key={group.key} />)}
        </div>
      )}
      {groups.length === 0 && (
        <p className="settlement-ui__section-description">{i18n._(M.details.soldiers.empty)}</p>
      )}
    </section>
  );
};

import { useLingui } from "@lingui/react";

import { SettlementIcon } from "../../components/settlement-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiStore } from "../ui-store";
import type { NoticeLink, NoticeRow } from "./helpers";
import type { MainPanelVisibilityStore } from "./main-panel";
import { useNotices } from "./use-notices";

interface NoticeBuildingLinkProps {
  link: NoticeLink;
  onFocusBuilding: (id: string) => void;
}
const NoticeBuildingLink = ({ link, onFocusBuilding }: NoticeBuildingLinkProps) => (
  <button
    className="settlement-ui__notification-building"
    disabled={link.disabled}
    title={link.title}
    type="button"
    onClick={() => onFocusBuilding(link.buildingId)}
  >
    {link.name}
  </button>
);

interface NoticeItemProps {
  row: NoticeRow;
  onFocusBuilding: (id: string) => void;
}
const NoticeItem = ({ row, onFocusBuilding }: NoticeItemProps) => (
  <div className="settlement-ui__overview-row">
    <SettlementIcon name="notice" />
    <span>
      <b>{row.title}</b>
      <small>
        {row.before}
        {row.link && <NoticeBuildingLink link={row.link} onFocusBuilding={onFocusBuilding} />}
        {row.after}
      </small>
    </span>
  </div>
);

interface NoticesViewProps {
  panel: MainPanelVisibilityStore;
  store: SettlementUiStore;
  onFocusBuilding: (id: string) => void;
}
/** Notifications: news and warnings; a named building links to its details while it exists. */
export const NoticesView = ({ panel, store, onFocusBuilding }: NoticesViewProps) => {
  const { i18n } = useLingui();
  const { empty, rows } = useNotices(panel, store);
  return (
    <>
      <p className="settlement-ui__section-description">{i18n._(M.menu.news)}</p>
      {rows.map(row => <NoticeItem key={row.id} row={row} onFocusBuilding={onFocusBuilding} />)}
      {empty && <p className="settlement-ui__empty">{i18n._(M.menu.noNews)}</p>}
    </>
  );
};

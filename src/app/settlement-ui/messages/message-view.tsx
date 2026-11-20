import { useLingui } from "@lingui/react";

import { BuildingIcon } from "../../components/building-icon";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { OpenRequestStore } from "../open-request";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import type {
  getInboxDetails, getMessageTabs, ReportDetails, ReportTile, ReportTileIcon, ScriptMailDetails
} from "./helpers";
import { useMessages } from "./use-messages";

interface TileIconProps {
  icon: ReportTileIcon;
  label: string;
}
const TileIcon = ({ icon, label }: TileIconProps) => {
  if (icon.kind === "picture") return <img alt="" src={icon.source} />;
  if (icon.kind === "ware") return <WareIcon title={label} ware={icon.ware} />;
  return <BuildingIcon bandit={icon.bandit} enclosure="building" theme="forest" type={icon.type} />;
};

interface TileSectionProps {
  tiles: readonly ReportTile[];
  title: string;
}
const TileSection = ({ tiles, title }: TileSectionProps) => {
  const { i18n } = useLingui();
  return (
  <section>
    <h3>{title}</h3>
    <div className="message-window__tiles">
      {tiles.length === 0 && <p>{i18n._(M.messages.none)}</p>}
      {tiles.map(({ count, icon, key, label }) => (
        <div className="message-window__tile" key={key} title={label}>
          <TileIcon icon={icon} label={label} />
          <span>{label}</span>
          <strong>{count}</strong>
        </div>
      ))}
    </div>
  </section>
  );
};

interface ReportProps {
  details: ReportDetails;
}
const Report = ({ details }: ReportProps) => {
  const { i18n } = useLingui();
  return (
  <article className="message-window__details">
    <h2>{details.island}</h2>
    <p>{details.date}</p>
    {details.incomplete && <p>{i18n._(M.messages.incomplete)}</p>}
    {details.sections.map(({ tiles, title }) => <TileSection key={title} tiles={tiles} title={title} />)}
    <p>{details.experience}</p>
    {details.rewardsTravelHome && <small>{i18n._(M.messages.rewardTravel)}</small>}
  </article>
  );
};

interface ScriptMailProps {
  details: ScriptMailDetails;
}
/** A scripted mail: title, island and date, the body paragraph and any goods it mentions. */
const ScriptMailView = ({ details }: ScriptMailProps) => (
  <article className="message-window__details message-window__mail">
    <h2>{details.title}</h2>
    <p className="message-window__mail-meta">{details.meta}</p>
    <p className="message-window__mail-body">{details.body}</p>
    {details.goods.length > 0 && <TileSection tiles={details.goods} title={details.goodsTitle} />}
  </article>
);

interface MessagesViewProps {
  details: ReturnType<typeof getInboxDetails>;
  tabs: ReturnType<typeof getMessageTabs>;
  onSelect: (id: string) => void;
}
const MessagesView = ({ details, tabs, onSelect }: MessagesViewProps) => {
  const { i18n } = useLingui();
  return (
  <>
    <nav aria-label={i18n._(M.messages.battleReports)}>
      {tabs.map(({ className, id, pressed, title }) => (
        <button aria-pressed={pressed} className={className} key={id} type="button" onClick={() => onSelect(id)}>
          {title}
        </button>
      ))}
    </nav>
    {details.battle && <Report details={details.battle} />}
    {details.script && <ScriptMailView details={details.script} />}
    {!details.battle && !details.script && (
      <article className="message-window__details">{i18n._(M.messages.empty)}</article>
    )}
  </>
  );
};

interface MessagesProps {
  request: OpenRequestStore;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
  onReadMessage?: (id: string) => void;
}
/** Inbox: the mail list on the left, the selected battle report or scripted mail on the right. */
export const Messages = ({ request, store, visibility, onReadMessage }: MessagesProps) => (
  <MessagesView {...useMessages(store, visibility, request, onReadMessage)} />
);

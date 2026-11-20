import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { IconButton } from "../../components/icon-button";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiOptions } from "../types";
import {
  getHarbourOrders, getHarbourPreparations, getHarbourShippingDemands, getHarbourShuttleText, getHarbourText,
  getPlannerButtons, getPotentialSettlementGate
} from "./harbour-helpers";
import type { BuildingDetailsData } from "./helpers";
import { useHarbourExpedition } from "./use-harbour-expedition";

interface HarbourSectionProps {
  data: BuildingDetailsData;
  options: SettlementUiOptions;
  uid: number;
}
/** Ordinary harbour panel actions: expeditions (exploration, settlement, colony, adventure) and the market. */
export const HarbourSection = ({ data, options, uid }: HarbourSectionProps) => {
  const { i18n } = useLingui();
  const harbour = useHarbourExpedition(uid, options, i18n);
  const text = getHarbourText(i18n);
  const planners = getPlannerButtons(Boolean(data.expeditionOngoing), Boolean(options.onOpenColonyPlanner),
    Boolean(options.onOpenAdventurePlanner), data, i18n);
  const shuttle = getHarbourShuttleText(data.harbourShuttle, i18n);
  const expeditionActive = (data.seaOrders ?? []).some(order =>
    order.sourceUid === uid && (order.expedition || order.exploration));
  const settlementGate = getPotentialSettlementGate(data, expeditionActive, i18n);
  const id = String(uid);
  return (
    <section className="settlement-ui__cargo-controls">
      <h3>{i18n._(M.details.harbour.pageTitle)}</h3>
      <IconButton
        caption={i18n._(M.details.harbour.exploreCaption)}
        data={{ "data-harbour-exploration": id }}
        disabled={harbour.exploreDisabled}
        hidden={harbour.hideExplore}
        icon="map"
        label={text.explore}
        title={harbour.exploreTitle}
        onClick={harbour.onExplore}
      />
      <IconButton
        caption={i18n._(M.details.harbour.colonyCaption)}
        data={{ "data-harbour-colony": id }}
        disabled={planners.colonyDisabled}
        hidden={planners.hideColony}
        icon="ship"
        label={text.colony}
        title={planners.colonyTitle}
        onClick={() => options.onOpenColonyPlanner?.(uid)}
      />
      <IconButton
        caption={i18n._(M.details.harbour.adventureCaption)}
        data={{ "data-harbour-adventure": id }}
        disabled={planners.adventureDisabled}
        hidden={planners.hideAdventure}
        icon="map"
        label={text.adventure}
        title={planners.adventureTitle}
        onClick={() => options.onOpenAdventurePlanner?.(uid)}
      />
      <small role="status">{harbour.status}</small>
      {shuttle && (
        <small className="settlement-ui__harbour-shuttle" data-harbour-shuttle={id} role="status"
          title={i18n._(M.details.harbour.shuttle)}>{shuttle}</small>
      )}
      {!settlementGate.hidden && harbour.potential.length > 0 && (
        <div className="settlement-ui__potential-settlements" data-potential-settlement={id}>
          <strong>{i18n._(M.details.harbour.potentialSettlement)}</strong>
          {expeditionActive && <small role="status">{text.busy}</small>}
          {harbour.potential.map((target, index) => (
            <div className="settlement-ui__potential-settlement-row" key={`${target.x}:${target.z}:${target.rotation}`}>
              <small>{translateMessage(i18n, M.details.harbour.potentialSite, {
                index: index + 1, x: Math.round(target.x), z: Math.round(target.z)
              })}</small>
              <IconButton
                caption={i18n._(M.details.harbour.occupyCaption)}
                data={{ "data-potential-settlement": id }}
                disabled={Boolean(settlementGate.blocked)}
                icon="build"
                label={i18n._(M.details.harbour.occupyHarbour)}
                title={settlementGate.blocked ?? i18n._(M.details.harbour.occupyHarbour)}
                onClick={() => harbour.onLaunchTarget(target)}
              />
            </div>
          ))}
        </div>
      )}
      {getHarbourPreparations(uid, data.expeditionPreparations, i18n).map(preparation => (
        <PreparationRow
          id={preparation.id}
          key={preparation.id}
          text={preparation.text}
          onCancel={() => harbour.onCancel(preparation.id, text.preparationCancelled, text.preparationLaunched)}
        />
      ))}
      {getHarbourShippingDemands(uid, data.shippingDemands, i18n).map(demand => (
        <small data-harbour-demand={demand.id} key={demand.id} role="status">{demand.text}</small>
      ))}
      {getHarbourOrders(uid, data.seaOrders, i18n).map(order => (
        <IconButton
          caption={order.label}
          icon="cancel"
          key={order.id}
          onClick={() => harbour.onCancel(order.id, text.orderCancelled, text.orderDone)}
        />
      ))}
    </section>
  );
};

interface PreparationRowProps {
  id: number;
  text: string;
  onCancel: () => void;
}
const CancelPreparation = ({ onCancel }: { onCancel: () => void }) => {
  const { i18n } = useLingui();
  return <IconButton caption={i18n._(M.details.harbour.cancelPreparation)} icon="cancel" onClick={onCancel} />;
};

const PreparationRow = ({ id, text, onCancel }: PreparationRowProps) => (
  <>
    <small data-expedition-preparation={id}>{text}</small>
    <CancelPreparation onCancel={onCancel} />
  </>
);

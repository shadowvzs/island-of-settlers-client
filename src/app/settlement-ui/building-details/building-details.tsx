import { useLingui } from "@lingui/react";
import type { ReactNode } from "react";

import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { BuildingFooter, DemolishButton, PauseButton, StoragePageButton } from "./building-footer";
import { CatapultAmmoSection } from "./catapult-ammo-section";
import { CompletedBuilding } from "./completed-building";
import { getConstructionDetails } from "./construction-helpers";
import { BuildingLevel, ConstructionSection } from "./construction-section";
import { getHarbourShippingDemands } from "./harbour-helpers";
import { type FooterActions, getFooterActions } from "./helpers";
import { getStoragePageToggle } from "./storage-helpers";
import { StorageCollect } from "./storage-section";
import { type BuildingDraftState, useBuildingDetails } from "./use-building-details";
import { WorkshopUpgrade } from "./workshop-upgrade";

interface FooterProps {
  actions: FooterActions;
  building: SettlementBuildingSummary;
  drafts: BuildingDraftState;
  options: SettlementUiOptions;
  visible: boolean;
}
const Footer = ({ actions, building, drafts, options, visible }: FooterProps) => {
  const { i18n } = useLingui();
  const uid = Number(building.id);
  const page = getStoragePageToggle(drafts.drafts.page, i18n, building.type === 39);
  return (
    <BuildingFooter>
      {actions.storageTools && <StorageCollect building={building} options={options} tool={drafts.drafts.tool} onTool={drafts.setTool} />}
      {actions.storagePage && (
        <StoragePageButton
          id={building.id}
          label={page.label}
          pressed={page.pressed}
          onToggle={() => drafts.setPage(page.next)}
        />
      )}
      {actions.pause && (
        <PauseButton
          id={building.id}
          paused={building.productionPaused ?? false}
          onPause={paused => options.onProductionPaused?.(uid, paused)}
        />
      )}
      <div className="settlement-ui__building-final-actions">
        {actions.demolish && <DemolishButton id={building.id} onDemolish={() => options.onDemolishBuilding?.(uid)} />}
        {actions.upgrade && <WorkshopUpgrade building={building} visible={visible}
          onUpgrade={cancel => options.onWorkshopUpgrade?.(uid, cancel)} />}
      </div>
    </BuildingFooter>
  );
};

interface BuildingDetailsViewProps {
  building: SettlementBuildingSummary;
  children: ReactNode;
  drafts: BuildingDraftState;
  options: SettlementUiOptions;
  visible: boolean;
}
const BuildingDetailsView = ({ building, children, drafts, options, visible }: BuildingDetailsViewProps) => {
  const actions = getFooterActions(building, options, drafts.drafts.page);
  return (
    <>
      <div className="settlement-ui__building-details-body">
        <div className="settlement-ui__building-details-heading">
          <BuildingLevel building={building} />
        </div>
        {children}
      </div>
      {actions && <Footer actions={actions} building={building} drafts={drafts} options={options} visible={visible} />}
    </>
  );
};

interface BuildingDetailsProps {
  options: SettlementUiOptions;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/**
 * Building details window content: level, then construction materials for a site, or the per-type
 * sections of a completed building, then the action row. Reads the snapshot only while visible.
 */
export const BuildingDetails = ({ options, store, visibility }: BuildingDetailsProps) => {
  const { i18n } = useLingui();
  const { data, drafts, visible } = useBuildingDetails(store, visibility);
  const building = data.building;
  if (!building) return null;
  const isSite = building.completed === false;
  const isHarbour = building.type === 39;
  let shipping: ReturnType<typeof getHarbourShippingDemands> = [];
  if (!isHarbour) shipping = getHarbourShippingDemands(Number(building.id), data.shippingDemands, i18n);
  return (
    <BuildingDetailsView building={building} drafts={drafts} options={options} visible={visible}>
      {isSite && <ConstructionSection details={getConstructionDetails(building, i18n)} />}
      {building.type === 16 && <CatapultAmmoSection ammo={building.catapultAmmo ?? "stone"}
        uid={Number(building.id)} onChange={options.onCatapultAmmo} />}
      {!isSite && <CompletedBuilding building={building} data={data} drafts={drafts} options={options} />}
      {shipping.map(demand => (
        <small data-harbour-demand={demand.id} key={demand.id} role="status">{demand.text}</small>
      ))}
    </BuildingDetailsView>
  );
};

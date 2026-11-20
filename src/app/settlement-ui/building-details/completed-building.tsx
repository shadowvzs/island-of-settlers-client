import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../types";
import { ArmoryOrders } from "./armory-orders";
import { CommanderSection } from "./commander-section";
import { FisherModeSection } from "./fisher-mode-section";
import { GarrisonSection } from "./garrison-section";
import { HarbourSection } from "./harbour-section";
import {
  type BuildingDetailsData, type CompletedSections, getCompletedSections, getMonumentNote, getQuarryNote
} from "./helpers";
import { ProductionModeSection } from "./production-mode-section";
import { ProductionSection } from "./production-section";
import { ResidenceSection } from "./residence-section";
import { SoldierDetailList, SoldierStorageRoster } from "./soldier-roster";
import { applyStorageCollect, getStorageAria, getStorageCapacityText, getStorageCells } from "./storage-helpers";
import { StorageWares } from "./storage-section";
import { TavernSection } from "./tavern-section";
import type { BuildingDraftState } from "./use-building-details";
import { getFarmArea, getStoneArea } from "./work-area-helpers";
import { WorkAreaSection } from "./work-area-section";
import { WorkforceSection } from "./workforce-section";

interface SectionProps {
  building: SettlementBuildingSummary;
  data: BuildingDetailsData;
  drafts: BuildingDraftState;
  options: SettlementUiOptions;
  sections: CompletedSections;
}

/** Headquarters / storehouse / harbour: Resources, Settlers or the local soldier reserve. */
export const StoragePages = ({ building, data, drafts, options }: SectionProps) => {
  const { i18n } = useLingui();
  if (drafts.drafts.page === "settlers")
    return <WorkforceSection availableSettlers={building.availableSettlers} workforce={building.workforce} />;
  if (drafts.drafts.page === "harbour")
    return <HarbourSection data={data} options={options} uid={Number(building.id)} />;
  if (drafts.drafts.page === "soldiers")
    return <SoldierStorageRoster nation={data.nation ?? "roman"} soldiers={building.soldiers ?? []} />;
  return (
    <StorageWares
      ariaLabel={getStorageAria(building, i18n)}
      buildingId={building.id}
      capacityText={getStorageCapacityText(building, i18n)}
      cells={getStorageCells(building, options, data.nation, data.level, i18n, drafts.drafts.tool)}
      onWare={ware => applyStorageCollect(building, options, drafts.drafts.tool, ware)}
    />
  );
};

/** Garrison, soldiers and Tavern: the military sections. */
const MilitarySections = ({ building, data, drafts, options, sections }: SectionProps) => {
  const uid = Number(building.id), nation = data.nation ?? "roman";
  return (
    <>
      {sections.commander && (
        <CommanderSection
          commander={building.commander}
          nation={nation}
          recruit={building.commanderRecruit}
          uid={uid}
          onLevelUp={options.onCommanderLevelUp}
          onRecruit={options.onRecruitCommander}
        />
      )}
      {sections.garrison && (
        <GarrisonSection
          garrison={building.garrison!}
          nation={nation}
          soldiers={building.soldiers}
          uid={uid}
          onChange={options.onGarrisonComposition!}
          onCoinsAllowed={options.onMilitaryCoins}
          onTrainingFocus={options.onMilitaryTrainingFocus}
        />
      )}
      {sections.soldiers && !sections.storage && (
        <SoldierDetailList nation={nation} soldiers={building.soldiers!} />
      )}
      {sections.tavern && (
        <TavernSection
          draft={drafts.drafts.tavern}
          nation={nation}
          resources={data.resources}
          summary={building.tavern!}
          onDraft={drafts.setTavern}
          onRecruit={(type, count) => options.onTavernRecruit?.(uid, type, count)}
        />
      )}
    </>
  );
};

/** Work areas, quarry stock, product toggles, orders, output choice and the level upgrade. */
const ProductionControls = ({ building, options, sections }: Omit<SectionProps, "data" | "drafts">) => {
  const { i18n } = useLingui();
  const uid = Number(building.id), quarryNote = getQuarryNote(building, i18n);
  const monumentNote = getMonumentNote(building, i18n);
  return (
    <>
      {sections.farm && <WorkAreaSection area={getFarmArea(building, i18n)} />}
      {sections.stone && <WorkAreaSection area={getStoneArea(building, i18n)} />}
      {quarryNote && <p className="settlement-ui__hint">{quarryNote}</p>}
      {monumentNote && <p className="settlement-ui__hint">{monumentNote}</p>}
      {sections.armory && (
        <ArmoryOrders building={building} onChange={(ware, amount) => options.onProductionOrder?.(uid, ware, amount)} />
      )}
      {sections.fisherMode && (
        <FisherModeSection buildingId={building.id} status={building.fisherBoat!}
          onChange={mode => options.onFisherMode?.(uid, mode)} />
      )}
      {sections.productionMode && (
        <ProductionModeSection building={building}
          onSawmillMode={options.onSawmillMode && (mode => options.onSawmillMode?.(uid, mode))}
          onSelect={ware => options.onProductionMode?.(uid, ware)} />
      )}

    </>
  );
};

/** A completed building's sections in the window's established order (above the action row). */
export const CompletedBuilding = ({ building, data, drafts, options }: Omit<SectionProps, "sections">) => {
  const { i18n } = useLingui();
  const sections = getCompletedSections(building, data, options);
  const props = { building, data, drafts, options, sections };
  let onShipyardMode: ((mode: "boats" | "ships") => boolean | void) | undefined;
  if (sections.shipyardMode) onShipyardMode = mode => options.onShipyardMode?.(Number(building.id), mode);
  return (
    <>
      {building.blockageHint && (
        <p className="settlement-ui__section-description">
          {translateMessage(i18n, M.details.whyWaiting, { reason: building.blockageHint })}
        </p>
      )}
      {sections.storage && <StoragePages {...props} />}
      {sections.production && <ProductionSection building={building} nation={data.nation}
        showOutput={sections.producedWares}
        onShipyardMode={onShipyardMode} />}
      {sections.residence && <ResidenceSection residence={building.residence!} />}
      <MilitarySections {...props} />
      <ProductionControls building={building} options={options} sections={sections} />
    </>
  );
};

import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { ROCK_PALETTES, SAND_PALETTES, SOIL_PALETTES } from "../../../shared/world/ground-palette";
import { nationsTypicalOfPalette } from "../../../shared/world/nation-terrain-affinity";
import { MAP_FILE_EXTENSION } from "../../../shared/world/save/map-format";
import { MAP_ACTIONS } from "../editor-catalog";
import type { EnvironmentDefaultsEditor } from "../environment-defaults-editor";
import { AUTO_PALETTE, type GroundPaletteEditor } from "../ground-palette-editor";
import type { MapLibrary } from "../map-library";
import { MAP_EDITOR_MESSAGES as M, resolveEditorText } from "../messages";
import { ROAD_ACTION_MESSAGES, ROAD_ACTIONS, type ScenarioRoadEditor } from "../scenario-road-editor";
import { type FieldOption, toTextOptions } from "../section-store";
import {
  ActionButton, ActionRow, AuthoringControls, ChoiceField, EditorSection, NumberField, StatusText, ToolButton
} from "./fields";
import { TOOL_CLASS } from "./tool-grid";
import { type CatalogRow, MAX_MAP_NAME_LENGTH, type SlotRow, useMapSection } from "./use-map-section";
import { useSection } from "./use-section";

const ROAD_OPTIONS: readonly FieldOption[] = ROAD_ACTIONS.map((value, index) => ({
  label: ROAD_ACTION_MESSAGES[index]!,
  value
}));
const WEATHER_OPTIONS: readonly FieldOption[] = toTextOptions(["clear", "rain", "snow"])
  .map(option => ({ ...option, label: M.option.weather[option.value as "clear" | "rain" | "snow"] }));
const SAND_OPTIONS: readonly FieldOption[] = [AUTO_PALETTE, ...SAND_PALETTES]
  .map(value => ({ label: M.option.sandPalette[value], nations: nationsTypicalOfPalette("sand", value), value }));
const SOIL_OPTIONS: readonly FieldOption[] = [AUTO_PALETTE, ...SOIL_PALETTES]
  .map(value => ({ label: M.option.soilPalette[value], nations: nationsTypicalOfPalette("soil", value), value }));
const ROCK_OPTIONS: readonly FieldOption[] = [AUTO_PALETTE, ...ROCK_PALETTES]
  .map(value => ({ label: M.option.rockPalette[value], nations: nationsTypicalOfPalette("rock", value), value }));
const SLOT_BUTTON_CLASS = "map-editor__slot-button";

interface RoadsSectionProps {
  editor: ScenarioRoadEditor;
}
/** Initial authored roads of every tier and the harbour reservation. */
export const RoadsSection = ({ editor }: RoadsSectionProps) => {
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.roads} title={M.sections.roads}>
      <AuthoringControls>
        <ChoiceField {...field("mode")} label={M.fields.infrastructureAction} options={ROAD_OPTIONS}
          onChange={editor.setMode} />
        <NumberField {...field("rotation")} label={M.fields.harbourRotation} max={3} min={0} size="narrow" />
        <ActionRow>
          <ActionButton caption={M.captions.draw} label={M.actions.drawInfrastructure}
            onClick={editor.drawSelected} />
          <ActionButton caption={M.captions.cancelStart} label={M.actions.cancelRoadStart}
            onClick={editor.cancelStart} />
          <ActionButton caption={M.captions.removeHarbour} label={M.actions.removeHarbour}
            onClick={editor.removeHarbour} />
          <ActionButton caption={M.captions.removeRoads} label={M.actions.removeRoads}
            onClick={editor.removeRoads} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface EnvironmentSectionProps {
  editor: EnvironmentDefaultsEditor;
}
/** The map's starting hour, day cycle and weather for new Play. */
export const EnvironmentSection = ({ editor }: EnvironmentSectionProps) => {
  const { i18n } = useLingui();
  const { field, view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.environment} title={M.sections.environment}>
      <AuthoringControls>
        <NumberField {...field("hour")} ariaLabel={M.fields.startHourAria} label={M.fields.startHour} max={24}
          min={0} size="narrow" step="any" />
        <label>
          <input aria-label={translateMessage(i18n, M.fields.dayCycle)} checked={view.cycling} type="checkbox"
            onChange={event => editor.setCycling(event.target.checked)} />
          {translateMessage(i18n, M.fields.dayCycle)}
        </label>
        <ChoiceField {...field("weather")} label={M.fields.startWeather} options={WEATHER_OPTIONS} />
        <ActionRow>
          <ActionButton caption={M.captions.apply} label={M.actions.applyMapTime} onClick={editor.apply} />
          <ActionButton caption={M.captions.normalTime} label={M.actions.normalTime} onClick={editor.reset} />
        </ActionRow>
        <StatusText>{view.status}</StatusText>
      </AuthoringControls>
    </EditorSection>
  );
};

interface GroundPaletteSectionProps {
  editor: GroundPaletteEditor;
}
/** The island's beach sand, bare soil and rock colour: three compact selects, applied at once. */
export const GroundPaletteSection = ({ editor }: GroundPaletteSectionProps) => {
  const { view } = useSection(editor.section);
  return (
    <EditorSection info={M.help.groundPalette} title={M.sections.groundPalette}>
      <AuthoringControls>
        <ChoiceField label={M.fields.sandPalette} options={SAND_OPTIONS} value={view.sand}
          onChange={editor.setSand} />
        <ChoiceField label={M.fields.soilPalette} options={SOIL_OPTIONS} value={view.soil}
          onChange={editor.setSoil} />
        <ChoiceField label={M.fields.rockPalette} options={ROCK_OPTIONS} value={view.rock}
          onChange={editor.setRock} />
      </AuthoringControls>
    </EditorSection>
  );
};

interface SlotRowViewProps {
  busy: boolean;
  slot: SlotRow;
}
const SlotRowView = ({ busy, slot }: SlotRowViewProps) => (
  <li className="map-editor__slot">
    <span className="map-editor__slot-name" title={slot.name}>
      {slot.name}
      <small>{slot.date}</small>
    </span>
    <ToolButton action={MAP_ACTIONS.loadSlot} className={SLOT_BUTTON_CLASS} disabled={busy} onClick={slot.onLoad} />
    <ToolButton action={MAP_ACTIONS.overwriteSlot} className={SLOT_BUTTON_CLASS} disabled={busy}
      onClick={slot.onOverwrite} />
    <ToolButton action={MAP_ACTIONS.deleteSlot} className={SLOT_BUTTON_CLASS} disabled={busy} onClick={slot.onDelete} />
  </li>
);

interface CatalogRowViewProps {
  busy: boolean;
  row: CatalogRow;
}
const CatalogRowView = ({ busy, row }: CatalogRowViewProps) => {
  let datePrefix = "";
  if (row.date) datePrefix = `${row.date} · `;
  let stateView;
  if (row.current)
    stateView = <span className="map-editor__catalog-current">{resolveEditorText(undefined, M.library.current)}</span>;
  else
    stateView = <ToolButton action={MAP_ACTIONS.rollbackStarter} className={SLOT_BUTTON_CLASS} disabled={busy}
      onClick={row.onRollback} />;
  return (
    <li className="map-editor__slot map-editor__catalog-row">
      <span className="map-editor__slot-name" title={row.name}>
        {row.name}
        <small>{datePrefix}r{row.revision}</small>
      </span>
      {stateView}
    </li>
  );
};

interface MapLibrarySectionProps {
  library: MapLibrary;
}
/** The map's name, map files and the maps saved in this browser (load, overwrite, delete). */
export const MapLibrarySection = ({ library }: MapLibrarySectionProps) => {
  const { i18n } = useLingui();
  const {
    busy, campaignNote, campaignSlot, catalog, catalogError, catalogLoaded, currentStarter, name, note, noteHidden,
    picker, slots, storage, onFileChosen, onLoadFile, onNameChange, onNameKey
  } = useMapSection(library);
  let catalogBody = <p className="map-editor__help">{translateMessage(i18n, M.library.catalogEmpty)}</p>;
  if (catalog.length) catalogBody = (
    <ul className="map-editor__slots">
      {catalog.map(row => <CatalogRowView busy={busy} key={row.id} row={row} />)}
    </ul>
  );
  return (
    <EditorSection title={M.sections.library}>
      <label className="map-editor__name">
        {translateMessage(i18n, M.fields.name)}
        <input maxLength={MAX_MAP_NAME_LENGTH} type="text" value={name}
          onChange={event => onNameChange(event.target.value)} onKeyDown={onNameKey} onKeyUp={onNameKey} />
      </label>
      {campaignNote && <p className="map-editor__help" role="note">{resolveEditorText(i18n, campaignNote)}</p>}
      <div className="map-editor__tools">
        <ToolButton action={MAP_ACTIONS.saveFile} className={TOOL_CLASS} disabled={busy} hidden={campaignSlot}
          onClick={library.saveFile} />
        <ToolButton action={MAP_ACTIONS.saveCampaignMap} className={TOOL_CLASS} disabled={busy} hidden={!campaignSlot}
          onClick={library.saveFile} />
        <ToolButton action={MAP_ACTIONS.backToCampaign} className={TOOL_CLASS} disabled={busy} hidden={!campaignSlot}
          onClick={library.backToCampaign} />
        <ToolButton action={MAP_ACTIONS.publishStarter} className={TOOL_CLASS} disabled={busy} hidden={campaignSlot}
          onClick={library.publishStarter} />
        <ToolButton action={MAP_ACTIONS.loadFile} className={TOOL_CLASS} disabled={busy} onClick={onLoadFile} />
        <ToolButton action={MAP_ACTIONS.newSlot} className={TOOL_CLASS} disabled={busy} hidden={!storage}
          onClick={library.saveNewSlot} />
        <input accept={MAP_FILE_EXTENSION} hidden ref={picker} type="file" onChange={onFileChosen} />
      </div>
      <ul aria-label={translateMessage(i18n, M.library.slots)} className="map-editor__slots">
        {slots.map(slot => <SlotRowView busy={busy} key={slot.id} slot={slot} />)}
      </ul>
      <p className="map-editor__help" hidden={noteHidden}>{resolveEditorText(i18n, note)}</p>
      {catalogLoaded && <section aria-label={translateMessage(i18n,
        M.library.catalogTitle)} className="map-editor__catalog">
        <h3>{translateMessage(i18n, M.library.catalogTitle)}</h3>
        {currentStarter && <p className="map-editor__help">{translateMessage(i18n, M.library.catalogCurrent, {
          name: currentStarter.metadata.name, revision: currentStarter.revision
        })}</p>}
        {catalogBody}
      </section>}
      {catalogError && <p className="map-editor__help" role="status">{catalogError}</p>}
    </EditorSection>
  );
};

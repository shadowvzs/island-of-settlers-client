import { Tabs } from "../../components/tabs";
import { OptionGrid } from "../reward-picker/option-grid";
import { RewardPicker } from "../reward-picker/reward-picker";
import type { PickerSpec } from "./block-parts";
import { focusOnMount } from "./focus";
import type { SelectorFilters } from "./slot-picker-model";
import { TextLanguageInputs } from "./text-language-inputs";
import { useCatalogPanel, useFamilyPanel, useRewardLines, useValueInput } from "./use-picker-panels";
import type { SlotPickerView } from "./use-slot-picker";

interface ChoiceListProps {
  view: SlotPickerView;
}
/** One button per choice; the current value is pressed. */
export const ChoiceList = ({ view }: ChoiceListProps) => (
  <>
    {!view.choices.length && <p className="script-form__note">{view.nothingLabel}</p>}
    <ul className="script-picker__choices">
      {view.choices.map(choice => (
        <li key={choice.key}>
          <button aria-pressed={choice.selected} type="button" onClick={() => view.onChoose(choice.value)}>
            {choice.label}
          </button>
        </li>
      ))}
    </ul>
  </>
);

interface FilterBarProps {
  view: SlotPickerView;
}
/** Owner (required outside an event subject) and region filters of a type or family selector. */
export const FilterBar = ({ view }: FilterBarProps) => (
  <div className="script-picker__filters">
    <label>{view.ownerLabel}<select value={JSON.stringify(view.filters.owner)}
      onChange={event => view.onOwner(event.target.value)}>
      {view.ownerChoices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
    </select></label>
    <label>{view.regionFilterLabel}<select value={view.filters.region ?? ""}
      onChange={event => view.onRegion(event.target.value)}>
      <option value="">{view.noRegionLabel}</option>
      {view.regionChoices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
    </select></label>
  </div>
);

interface CatalogPanelProps {
  filters: SelectorFilters;
  idPrefix: string;
  spec: PickerSpec;
  value: unknown;
  onChoose: (value: unknown) => void;
}
/** The catalog as single-select tabs (Settlers, Soldiers, Buildings, Ships, Animals, Nature, Doodads, Wares). */
export const CatalogPanel = ({ filters, idPrefix, spec, value, onChoose }: CatalogPanelProps) => {
  const view = useCatalogPanel(spec, value, filters, onChoose);
  return (
    <div className="script-picker__catalog reward-picker">
      <div className="script-picker__filters">
        <input aria-label={view.searchLabel} placeholder={view.searchLabel} type="search" value={view.query}
          onChange={event => view.onQuery(event.target.value)} />
        {view.qualifies && (
          <>
            <label>{view.nationLabel}<select value={view.nation} onChange={event => view.onNation(event.target.value)}>
              {view.nations.map(nation => <option key={nation.key} value={nation.key}>{nation.label}</option>)}
            </select></label>
            <label>{view.rankLabel}<select value={view.rank} onChange={event => view.onRank(event.target.value)}>
              {view.ranks.map(rank => <option key={rank.key} value={rank.key}>{rank.label}</option>)}
            </select></label>
          </>
        )}
      </div>
      <Tabs idPrefix={idPrefix} items={view.tabs.map(tab => ({
        content: <OptionGrid noMatches="" options={tab.options} onPick={view.onPick} />, id: tab.id, label: tab.label
      }))} label={view.tabsLabel} listClassName="reward-picker__tabs" panelClassName="reward-picker__panel"
      tabClassName="reward-picker__tab" />
    </div>
  );
};

interface FamilyPanelProps {
  spec: PickerSpec;
  value: unknown;
  view: SlotPickerView;
}
/** The catalog's family paths as an indented tree with member previews. */
export const FamilyPanel = ({ spec, value, view }: FamilyPanelProps) => {
  const nodes = useFamilyPanel(spec, value);
  return (
    <ul className="script-picker__tree">
      {nodes.map(node => (
        <li data-depth={node.depth} key={node.path}>
          <button aria-pressed={node.selected} type="button" onClick={() => view.onChoose(view.withFilters({
            family: { id: node.path, k: "ref", kind: "family" }, kind: "family" }))}>
            <strong>{node.label}</strong> <span>{node.members}</span> <small>{node.countText}</small>
          </button>
        </li>
      ))}
    </ul>
  );
};

interface ValueInputProps {
  chooseLabel: string;
  math: boolean;
  spec: PickerSpec;
  value: unknown;
  onChoose: (value: unknown) => void;
}
/** A typed input with its "Choose" button (Enter chooses too). */
export const ValueInput = ({ chooseLabel, math, spec, value, onChoose }: ValueInputProps) => {
  const view = useValueInput(spec, value, onChoose);
  if (math) return <button type="button" onClick={view.onMath}>{view.mathLabel}</button>;
  return (
    <form className="script-picker__input" onSubmit={event => { event.preventDefault(); view.onSubmit(); }}>
      {view.kind === "text" && <TextLanguageInputs focusFirst rows={view.textRows} onChange={view.onTextLanguage} />}
      {view.kind !== "text" && (
        <label>{view.label}<input inputMode={view.inputMode} ref={focusOnMount} value={view.text}
          onChange={event => view.onText(event.target.value)} /></label>
      )}
      <button type="submit">{chooseLabel}</button>
    </form>
  );
};

interface RewardLinesProps {
  chooseLabel: string;
  idPrefix: string;
  kind: "goods" | "rewards" | "soldiers";
  value: unknown;
  onChoose: (value: unknown) => void;
}
/** Rewards, goods or soldier lines through the shared RewardPicker. */
export const RewardLines = ({ chooseLabel, idPrefix, kind, value, onChoose }: RewardLinesProps) => {
  const view = useRewardLines(kind, value, onChoose);
  return (
    <>
      <RewardPicker entries={view.entries} idPrefix={idPrefix} tabs={view.tabs} onChange={view.onChange} />
      <button type="button" onClick={view.onSubmit}>{chooseLabel}</button>
    </>
  );
};

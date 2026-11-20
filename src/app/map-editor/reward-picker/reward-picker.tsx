import { joinClassNames } from "../../components/helpers";
import { INPUT_SIZE_CLASSES } from "../../components/input-sizes";
import { Tabs } from "../../components/tabs";
import { useNumberDraft } from "../../components/use-number-draft";
import { RewardIcons, RewardPicture } from "../../settlement-ui/reward-icons/reward-icons";
import type { SelectedRewardRow } from "./helpers";
import { OptionGrid } from "./option-grid";
import { type RewardPickerOptions, type RewardPickerView, useRewardPicker } from "./use-reward-picker";

import "./reward-picker.css";

interface AmountFieldProps {
  label: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
}
const AmountField = ({ label, max, value, onChange }: AmountFieldProps) => {
  const draft = useNumberDraft(value, onChange);
  return (
    <input aria-label={label} className={joinClassNames("reward-picker__amount", INPUT_SIZE_CLASSES.count)}
      inputMode="numeric" max={max} min={1} type="number" value={draft.text} onBlur={draft.onBlur}
      onChange={event => draft.onInput(event.target.value)} />
  );
};

interface SelectedLineProps {
  row: SelectedRewardRow;
  onAmountChange: RewardPickerView["onAmountChange"];
  onRemove: RewardPickerView["onRemove"];
}
const RemoveButton = ({ row, onRemove }: Pick<SelectedLineProps, "onRemove" | "row">) => (
  <button aria-label={row.removeLabel} className="reward-picker__remove" title={row.removeLabel} type="button"
    onClick={() => onRemove(row.key)}>×</button>
);

/** A coin, XP or gem line: picture, amount and remove only (the picture's title names it), on the shared row. */
const CurrencyChip = ({ row, onAmountChange, onRemove }: SelectedLineProps) => (
  <li className="reward-picker__currency" title={row.label}>
    <span className="reward-picker__picture"><RewardPicture icon={row.icon} label={row.label} /></span>
    {row.amount !== null && <AmountField label={row.amountLabel} max={row.max} value={row.amount}
      onChange={value => onAmountChange(row.key, value)} />}
    <RemoveButton row={row} onRemove={onRemove} />
  </li>
);

const SelectedRow = ({ row, onAmountChange, onRemove }: SelectedLineProps) => (
  <li className="reward-picker__row" data-warning={Boolean(row.warning)}>
    <span className="reward-picker__picture"><RewardPicture icon={row.icon} label={row.label} /></span>
    <span className="reward-picker__row-name">
      {row.label}
      {row.warning && <span className="reward-picker__warning" role="alert">{row.warning}</span>}
    </span>
    {row.amount !== null && <AmountField label={row.amountLabel} max={row.max} value={row.amount}
      onChange={value => onAmountChange(row.key, value)} />}
    <RemoveButton row={row} onRemove={onRemove} />
  </li>
);

type RewardPickerProps = RewardPickerOptions & {
  /** Unique per page: tab and panel ids derive from it. */
  idPrefix: string;
};
/**
 * Reusable reward selection panel (campaign map rewards now; quest rewards in C7b/C9): tabs of choosable rewards
 * with icons and a quick search, then the selected lines with amounts and the shared icon summary. `tabs` sets
 * which kinds are offered and in which order (`filter` narrows the options inside them); `nation` sets portraits
 * and troop names.
 */
export const RewardPicker = ({ copy, entries, filter, idPrefix, nation, tabs, onChange }: RewardPickerProps) => {
  const view = useRewardPicker({ copy, entries, filter, nation, tabs, onChange });
  return (
    <section aria-label={view.title} className="reward-picker">
      <div className="reward-picker__selected">
        <h4>{view.selectedTitle}</h4>
        {!view.hasSelection && <p className="reward-picker__hint">{view.emptyNote}</p>}
        {view.summary.hasRewards && <RewardIcons className="reward-picker__summary" view={view.summary} />}
        <ul className="reward-picker__currencies">
          {view.currencyRows.map(row => <CurrencyChip key={row.key} row={row} onAmountChange={view.onAmountChange}
            onRemove={view.onRemove} />)}
        </ul>
        <ul className="reward-picker__rows">
          {view.rows.map(row => <SelectedRow key={row.key} row={row} onAmountChange={view.onAmountChange}
            onRemove={view.onRemove} />)}
        </ul>
      </div>
      <div className="reward-picker__catalog">
        <h4>{view.title}</h4>
        <input aria-label={view.searchLabel} className="reward-picker__search" placeholder={view.searchPlaceholder}
          type="search" value={view.query} onChange={event => view.onQueryChange(event.target.value)} />
        <Tabs idPrefix={idPrefix} items={view.tabs.map(tab => ({
          content: <OptionGrid noMatches={tab.noMatches} options={tab.options} onPick={view.onPick} />,
          id: tab.id, label: tab.label
        }))} label={view.tabsLabel} listClassName="reward-picker__tabs" panelClassName="reward-picker__panel"
        tabClassName="reward-picker__tab" />
      </div>
    </section>
  );
};

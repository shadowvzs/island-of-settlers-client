import type { I18n } from "@lingui/core";
import { useLingui } from "@lingui/react";
import type { ReactNode, Ref } from "react";

import { displayNationName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { joinClassNames } from "../../components/helpers";
import { InfoTooltip } from "../../components/info-tooltip";
import { INPUT_SIZE_CLASSES, type InputSize } from "../../components/input-sizes";
import { Section } from "../../components/section";
import type { MapAction } from "../editor-catalog";
import { type EditorText, editorTextSource, MAP_EDITOR_MESSAGES as M, resolveEditorText } from "../messages";
import type { FieldOption } from "../section-store";
import { type ActionIcon, getActionButtonLook, getActionIcon, getToolClassName } from "./action-icons";

/** A decorative icon image (its button carries the name). */
export const IconImage = ({ icon }: { icon: ActionIcon }) => (
  <img
    alt=""
    className={icon.className}
    draggable={false}
    loading={icon.loading}
    src={icon.src}
    srcSet={icon.srcSet}
  />
);

interface ToolButtonProps {
  action: MapAction;
  active?: boolean;
  className: string;
  disabled?: boolean;
  hidden?: boolean;
  pressed?: boolean;
  onClick: () => void;
}
/** The nations-typical-of text of an association (NATION-TERRAIN), "" when there is none. */
const nationsTooltip = (nations: readonly string[] | undefined, i18n: I18n) => {
  if (!nations?.length) return "";
  const names = nations.map(nation => displayNationName(nation, i18n)).join(", ");
  return translateMessage(i18n, M.info.typicalOf, { nations: names });
};

/** The tooltip of an action: its name plus the nations its homeland association is typical of. */
const actionTooltip = (label: string, nations: readonly string[] | undefined, i18n: I18n) => {
  const typical = nationsTooltip(nations, i18n);
  if (!typical) return label;
  return `${label} — ${typical}`;
};

/** An icon button of a tool, map or history action, named by its translated title and aria-label. */
export const ToolButton = ({ action, active, className, disabled, hidden, pressed, onClick }: ToolButtonProps) => {
  const { i18n } = useLingui();
  const label = resolveEditorText(i18n, action.message ?? action.label);
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={getToolClassName(className, active)}
      disabled={disabled}
      hidden={hidden}
      title={actionTooltip(label, action.nations, i18n)}
      type="button"
      onClick={onClick}
    >
      <ToolButtonFace action={action} label={label} />
    </button>
  );
};

const ToolButtonFace = ({ action, label }: { action: MapAction; label: string }) => {
  const icon = getActionIcon(action.icon);
  if (!icon) return label;
  return <IconImage icon={icon} />;
};

interface ActionButtonProps {
  /** Short visible text; the full label stays the tooltip and accessible name. */
  caption?: EditorText;
  disabled?: boolean;
  icon?: string;
  label: EditorText;
  pressed?: boolean;
  onClick: () => void;
}
/** One action button look for the whole editor: its meaning's icon and a short caption, same size. */
export const ActionButton = ({ caption, disabled, icon, label, pressed, onClick }: ActionButtonProps) => {
  const { i18n } = useLingui();
  const resolvedLabel = resolveEditorText(i18n, label);
  let displayedCaption = resolvedLabel;
  let sourceCaption: string | undefined;
  if (caption !== undefined) {
    displayedCaption = resolveEditorText(i18n, caption);
    sourceCaption = editorTextSource(caption);
  }
  const look = getActionButtonLook(editorTextSource(label), icon, sourceCaption);
  return (
    <button aria-label={resolvedLabel} aria-pressed={pressed} className="map-editor__action" disabled={disabled}
      title={resolvedLabel} type="button" onClick={onClick}>
      {look.icon && <IconImage icon={look.icon} />}
      <span>{displayedCaption}</span>
    </button>
  );
};

interface ActionRowProps {
  children: ReactNode;
}
/** Related actions on one wrapping row (full width in a field grid). */
export const ActionRow = ({ children }: ActionRowProps) => (
  <div className="map-editor__actions">{children}</div>
);

interface HelpNoteProps {
  children: EditorText;
}
/** A long explanation behind a blue info button: hover, focus or tap shows it. */
export const HelpNote = ({ children }: HelpNoteProps) => {
  const { i18n } = useLingui();
  const label = resolveEditorText(i18n, M.common.howItWorks);
  return (
    <div className="map-editor__help-note">
      <InfoTooltip
        label={label}
        lines={[{ text: resolveEditorText(i18n, children) }]}
        variant="blue"
      />
    </div>
  );
};

/** Props of a field bound to a section store (see `useSectionFields`). */
export interface BoundFieldProps {
  inputRef?: Ref<HTMLInputElement | HTMLSelectElement>;
  value: string;
  onChange: (value: string) => void;
}

type NumberFieldProps = BoundFieldProps & {
  /** The accessible name when it differs from the visible label (it stays fixed while the label changes). */
  ariaLabel?: EditorText;
  /** Class of the label (e.g. the settings select look). */
  className?: string;
  label: EditorText;
  max?: number | string;
  min?: number | string;
  required?: boolean;
  /** Input width by expected value length (default: a count of up to 7 characters). */
  size?: InputSize;
  step?: string;
  onBlur?: () => void;
};
/** A labelled number input sized to its values, the label beside it; the label repeats as `aria-label`. */
export const NumberField = ({
  ariaLabel, className, inputRef, label, max, min, required, size = "count", step, value, onBlur, onChange
}: NumberFieldProps) => {
  const { i18n } = useLingui();
  const resolvedLabel = resolveEditorText(i18n, label);
  const resolvedAria = resolveEditorText(i18n, ariaLabel ?? label);
  return (
    <label className={joinClassNames("map-editor__number-field", className)}>
      {resolvedLabel}
      <input
        aria-label={resolvedAria}
        className={INPUT_SIZE_CLASSES[size]}
        max={max}
        min={min}
        ref={inputRef as Ref<HTMLInputElement>}
        required={required}
        step={step}
        type="number"
        value={value}
        onBlur={onBlur}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  );
};

/** A section body of labelled authoring fields in a two-column grid. */
export const AuthoringControls = ({ children }: { children: ReactNode }) => (
  <div className="map-editor__authoring-controls">{children}</div>
);

type ChoiceFieldProps = BoundFieldProps & {
  /** Class of the label (e.g. `map-editor__wide-field` to span the field grid). */
  className?: string;
  hidden?: boolean;
  label: EditorText;
  options: readonly FieldOption[];
};
/** A labelled select of text values; the label repeats as `aria-label`. */
export const ChoiceField = ({ className, hidden, inputRef, label, options, value, onChange }: ChoiceFieldProps) => {
  const { i18n } = useLingui();
  return (
    <label className={className} hidden={hidden}>
      {resolveEditorText(i18n, label)}
      <ListSelect inputRef={inputRef} label={label} options={options} value={value} onChange={onChange} />
    </label>
  );
};

interface ListSelectProps {
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement | HTMLSelectElement>;
  label: EditorText;
  options: readonly FieldOption[];
  value: string;
  onChange: (value: string) => void;
}
/** A select named by its `aria-label` alone (lists of authored objects); hidden while it has no options. */
export const ListSelect = ({ disabled, inputRef, label, options, value, onChange }: ListSelectProps) => {
  const { i18n } = useLingui();
  const selected = options.find(option => option.value === value);
  return (
    <select
      aria-label={resolveEditorText(i18n, label)}
      disabled={disabled}
      hidden={options.length === 0}
      ref={inputRef as Ref<HTMLSelectElement>}
      title={nationsTooltip(selected?.nations, i18n) || undefined}
      value={value}
      onChange={event => onChange(event.target.value)}
    >
      {options.map(option => (
        <option key={option.value} title={nationsTooltip(option.nations, i18n) || undefined}
          value={option.value}>{resolveEditorText(i18n, option.label)}</option>
      ))}
    </select>
  );
};

interface StatusTextProps {
  children: EditorText;
  className?: string;
  hidden?: boolean;
}
/** A text value resolved in the active locale (descriptors never reach the DOM as objects). */
export const TextValue = ({ value }: { value?: EditorText }) => {
  const { i18n } = useLingui();
  return <>{resolveEditorText(i18n, value)}</>;
};

/** A live status line of a section. */
export const StatusText = ({ children, className, hidden }: StatusTextProps) => {
  const { i18n } = useLingui();
  return <p className={className} hidden={hidden} role="status">{resolveEditorText(i18n, children)}</p>;
};

interface EditorSectionProps {
  children: ReactNode;
  icon?: string;
  /** A long explanation shown by the blue info button beside the section title. */
  info?: EditorText;
  title: EditorText;
}
/** A section whose title and info text are resolved in the active locale. */
export const EditorSection = ({ children, icon, info, title }: EditorSectionProps) => {
  const { i18n } = useLingui();
  const resolvedTitle = resolveEditorText(i18n, title);
  let sectionInfo;
  if (info !== undefined) sectionInfo = { label: resolvedTitle, text: resolveEditorText(i18n, info) };
  return <Section icon={icon} info={sectionInfo} title={resolvedTitle}>{children}</Section>;
};

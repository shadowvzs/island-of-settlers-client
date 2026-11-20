import type { Ref } from "react";

import { getFieldIds } from "./helpers";

import "./account-fields.css";

export interface AccountFieldProps {
  autocomplete: string;
  error: string | undefined;
  hint?: string;
  /** Element id prefix (default `account`): forms shown together need distinct ids. */
  idPrefix?: string;
  inputRef: Ref<HTMLInputElement>;
  label: string;
  maxLength: number;
  name: string;
  type: "email" | "password" | "text";
  value: string;
  onValueChange: (value: string) => void;
}

/** A labelled text field with an optional hint and its own error line (aria-describedby). */
export const AccountField = ({
  autocomplete, error, hint, idPrefix = "account", inputRef, label, maxLength, name, type, value,
  onValueChange
}: AccountFieldProps) => {
  const { describedBy, errorId, hintId } = getFieldIds(idPrefix, name, Boolean(hint));
  return (
    <label className="account-field">
      <span className="account-field__label">{label}</span>
      <input
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        autoCapitalize="off"
        autoComplete={autocomplete}
        className="account-field__input"
        maxLength={maxLength}
        name={name}
        ref={inputRef}
        required
        spellCheck={false}
        type={type}
        value={value}
        onChange={event => onValueChange(event.target.value)}
      />
      {hint && <small className="account-field__hint" id={hintId}>{hint}</small>}
      <small className="account-field__error" id={errorId}>{error}</small>
    </label>
  );
};

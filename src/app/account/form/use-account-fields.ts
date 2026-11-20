import { useRef, useState } from "react";

import { type FieldErrors, getFirstInvalid, withoutError } from "./helpers";

/**
 * Values, error lines and inputs of an account form. `fieldProps(name)` binds an `AccountField`; typing calls
 * `onInput` (default: clears that field's error).
 */
export const useAccountFields = <Name extends string, ErrorName extends string = Name>(
  initial: Record<Name, string>,
  onInput?: (values: Record<Name, string>) => void
) => {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors<ErrorName>>({});
  const inputs = useRef<Partial<Record<Name, HTMLInputElement | null>>>({});
  const focusField = (name: Name) => inputs.current[name]?.focus();
  const changeValue = (name: Name, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    if (onInput) onInput(next);
    else setErrors(current => withoutError(current, name as unknown as ErrorName));
  };
  /** Shows the errors and focuses the first invalid field of `order`; false when none of them is invalid. */
  const showErrors = (next: FieldErrors<ErrorName>, order: readonly (Name & ErrorName)[] = []) => {
    setErrors(next);
    const invalid = getFirstInvalid(order, next as FieldErrors<Name & ErrorName>);
    if (invalid) focusField(invalid);
    return invalid !== null;
  };
  const fieldProps = (name: Name & ErrorName) => ({
    error: errors[name],
    inputRef: (input: HTMLInputElement | null) => { inputs.current[name] = input; },
    name,
    value: values[name],
    onValueChange: (value: string) => changeValue(name, value)
  });
  return { errors, fieldProps, focusField, setErrors, showErrors, values };
};

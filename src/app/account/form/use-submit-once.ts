import { type FormEvent, useState } from "react";

import { type FormStatus, NO_STATUS, toErrorStatus } from "./helpers";

/**
 * One form submission at a time with the submit button disabled; a thrown error shows `failure` in the form
 * status. `initial` is the status shown when the form opens (e.g. an import notice). An action that resolves
 * `true` has finished for good (the page moves on, e.g. after deleting the account): the buttons stay busy.
 */
export const useSubmitOnce = (
  failure: string, action: () => Promise<boolean | void>, initial: FormStatus = NO_STATUS
) => {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initial);
  const submit = async () => {
    setBusy(true);
    setStatus(NO_STATUS);
    try {
      if (await action() === true) return;
    } catch {
      setStatus(toErrorStatus(failure));
    }
    setBusy(false);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };
  return { busy, setStatus, status, submit, onSubmit };
};

import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { collectRegistrationErrors, type Registration, type RegistrationErrors } from "../account-store";
import { REGISTRATION_FIELD_ORDER } from "../form/helpers";
import { useAccountFields } from "../form/use-account-fields";
import { useSubmitOnce } from "../form/use-submit-once";
import { focusRacePicker } from "../race-picker/helpers";
import { REGISTRATION_FAILED } from "./helpers";
import type { AccountFormOptions } from "./scroll-pages";

/**
 * Register mode of the scroll: display name, email, password and nation. After the first attempt every change
 * re-checks the fields; an accepted registration hands the new account to `onAccount`.
 */
export const useRegistrationForm = ({ onAccount, store }: AccountFormOptions) => {
  const { i18n } = useLingui();
  const [race, setRace] = useState<WorkerNation | null>(null);
  const submitted = useRef(false);
  const racePicker = useRef<HTMLDivElement>(null);
  const revalidate = (credentials: Omit<Registration, "race">, nation: WorkerNation | null) => {
    // Called only from later input callbacks, after `fields` below is initialised.
    // oxlint-disable-next-line react/immutability
    if (submitted.current) fields.setErrors(collectRegistrationErrors({ ...credentials, race: nation }, i18n));
  };
  const fields = useAccountFields<keyof Omit<Registration, "race">, keyof RegistrationErrors>(
    { displayName: "", email: "", password: "" },
    values => revalidate(values, race)
  );
  const form = useSubmitOnce(i18n._(REGISTRATION_FAILED), async () => {
    submitted.current = true;
    const result = await store.register({ ...fields.values, race }, i18n);
    if (result.ok) {
      onAccount(result.account);
      return;
    }
    if (!fields.showErrors(result.errors, REGISTRATION_FIELD_ORDER)) focusRacePicker(racePicker.current);
  });
  const onRaceSelect = (nation: WorkerNation) => {
    setRace(nation);
    revalidate(fields.values, nation);
  };
  useEffect(() => fields.focusField("displayName"), []);
  return {
    busy: form.busy,
    fieldProps: fields.fieldProps,
    race,
    raceError: fields.errors.race,
    racePicker,
    status: form.status,
    onRaceSelect,
    onSubmit: form.onSubmit
  };
};

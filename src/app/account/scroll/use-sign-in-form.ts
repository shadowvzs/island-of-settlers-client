import { useLingui } from "@lingui/react";
import { useEffect } from "react";

import { CREDENTIAL_FIELD_ORDER } from "../form/helpers";
import { useAccountFields } from "../form/use-account-fields";
import { useSubmitOnce } from "../form/use-submit-once";
import { SIGN_IN_FAILED } from "./helpers";
import type { AccountFormOptions } from "./scroll-pages";

/** Sign-in mode of the scroll: email and password, checked by the identity service. */
export const useSignInForm = ({ onAccount, store }: AccountFormOptions) => {
  const { i18n } = useLingui();
  const fields = useAccountFields({ email: "", password: "" });
  const form = useSubmitOnce(i18n._(SIGN_IN_FAILED), async () => {
    const result = await store.signIn(fields.values, i18n);
    if (result.ok) {
      onAccount(result.account);
      return;
    }
    fields.showErrors(result.errors, CREDENTIAL_FIELD_ORDER);
  });
  useEffect(() => fields.focusField("email"), []);
  return { busy: form.busy, fieldProps: fields.fieldProps, status: form.status, onSubmit: form.onSubmit };
};

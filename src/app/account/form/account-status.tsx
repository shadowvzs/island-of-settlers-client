import { type FormStatus, getStatusClassName } from "./helpers";

import "./account-fields.css";

interface AccountStatusProps {
  className: string;
  status: FormStatus;
}
/** Storage failures and other form-wide messages (announced). */
export const AccountStatus = ({ className, status }: AccountStatusProps) => (
  <p className={getStatusClassName(className, status)} role="alert">{status.message}</p>
);

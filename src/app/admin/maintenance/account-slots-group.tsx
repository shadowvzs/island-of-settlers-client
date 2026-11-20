import { AdminIconButton } from "../admin-icon-button";
import type { useAccountSlots } from "./use-account-slots";

interface AccountSlotsGroupProps {
  title: string;
  view: ReturnType<typeof useAccountSlots>;
}
/** M5/M6: choose an account, then catch up or re-verify (placeholder) one of its cloud slots. */
export const AccountSlotsGroup = ({ title, view }: AccountSlotsGroupProps) => (
  <fieldset className="admin-settings__group admin-maintenance__group">
    <legend>{title}</legend>
    <label className="admin-settings__field">
      <span>{view.chooseLabel}</span>
      <select value={view.accountId} onChange={event => view.select(event.target.value)}>
        <option value="">{view.placeholder}</option>
        {view.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
    </label>
    {view.rows.map(row => (
      <div className="admin-maintenance__slot" key={row.id}>
        <span>{row.text}</span>
        <AdminIconButton disabled={row.catchUpBlocked} icon="reload" label={row.catchUpLabel} onClick={row.catchUp} />
        <AdminIconButton disabled icon="verify" label={row.verifyLabel} onClick={() => undefined} />
      </div>
    ))}
    {view.emptyText && <p className="admin-settings__note">{view.emptyText}</p>}
    {view.error && <p className="admin-settings__issues" role="alert">{view.error}</p>}
  </fieldset>
);

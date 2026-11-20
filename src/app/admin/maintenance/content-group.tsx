import { AdminIconButton } from "../admin-icon-button";
import type { useContentRows } from "./use-content-rows";

interface ContentGroupProps {
  title: string;
  view: ReturnType<typeof useContentRows>;
  winterLabel: string;
}
/** M8 campaigns Ready ↔ Draft, M9 starter history with rollback, M10 global winter. */
export const ContentGroup = ({ title, view, winterLabel }: ContentGroupProps) => (
  <fieldset className="admin-settings__group admin-maintenance__group">
    <legend>{title}</legend>
    {view.winter !== null && (
      <label className="admin-settings__switch" data-tool="M10">
        <input checked={view.winter} type="checkbox" onChange={event => void view.setWinter(event.target.checked)} />
        <span className="admin-settings__switch-label">{winterLabel}</span>
      </label>
    )}
    {view.winterError && <p className="admin-settings__issues" role="alert">{view.winterError}</p>}
    <h3 className="admin-maintenance__subtitle">{view.campaignsTitle}</h3>
    {view.campaigns.map(row => (
      <div className="admin-maintenance__slot" data-tool="M8" key={row.id}>
        <span>{row.name} · {row.state}</span>
        <AdminIconButton icon={row.icon} label={row.label} onClick={row.onToggle} />
      </div>
    ))}
    {view.campaignsEmpty && <p className="admin-settings__note">{view.campaignsEmpty}</p>}
    <p className="admin-settings__note">{view.bundleNote}</p>
    <h3 className="admin-maintenance__subtitle">{view.starterTitle}</h3>
    {view.starter.map(row => (
      <div className="admin-maintenance__slot" data-tool="M9" key={row.id}>
        <span>{row.text}</span>
        {row.current && <span className="admin-maintenance__scope">{row.currentLabel}</span>}
        {!row.current && <AdminIconButton icon="restore" label={row.label} onClick={row.onRollback} />}
      </div>
    ))}
    {view.starterEmpty && <p className="admin-settings__note">{view.starterEmpty}</p>}
  </fieldset>
);

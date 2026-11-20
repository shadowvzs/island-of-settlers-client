import { Section } from "../../components/section";
import { Tabs } from "../../components/tabs";
import { useHotkeySettings } from "./use-hotkey-settings";

import "./hotkeys.css";

export const HotkeySection = () => {
  const settings = useHotkeySettings();
  return (
    <Section icon="settings" info={{ label: settings.title, text: settings.hint }} title={settings.title}>
      <Tabs idPrefix="settings-hotkeys" items={settings.groups.map(group => ({
          id: group.id, label: group.label, content: (
            <fieldset className="hotkey-settings__group">
              <legend>{group.label}</legend>
              {group.rows.map(row => (
                <label className="hotkey-settings__row" key={row.action}>
                  <span>{row.label}</span>
                  <input aria-label={row.label} autoComplete="off" readOnly type="text" value={row.value}
                    onBlur={settings.onBlur} onFocus={() => settings.onFocus(row.action)}
                    onKeyDown={event => settings.onKeyDown(row.action, event)} />
                </label>
              ))}
              {group.fixedRows.map(row => (
                <label className="hotkey-settings__row" key={row.id} title={settings.fixedTitle}>
                  <span>{row.label}</span>
                  <input aria-label={row.label} disabled readOnly type="text" value={row.value} />
                </label>
              ))}
            </fieldset>
          )
        }))} label={settings.title}
        listClassName="settings-panel__tabs" panelClassName="settings-panel__tab-content" />
      <p aria-live="polite" className="hotkey-settings__error" role="status">{settings.error}</p>
      <button className="hotkey-settings__reset" type="button" onClick={settings.onReset}>
        {settings.resetLabel}
      </button>
    </Section>
  );
};

import type { I18n } from "@lingui/core";
import { Fragment } from "react";

import { translateMessage } from "../../shared/i18n/translate";
import { useExternalStore } from "../components/external-store";
import { Section } from "../components/section";
import { useI18nRevision } from "../components/use-i18n-revision";
import { getMapPanelRows } from "./current-island-helpers";
import { IslandForm } from "./island-form";
import { MAP_GENERATOR_MESSAGES as M } from "./messages";
import type { MapPanelOptions } from "./panel";

interface IslandInfoProps {
  rows: readonly [string, string][];
}
/** Two-column read-only list of label / value rows. */
const IslandInfo = ({ rows }: IslandInfoProps) => (
  <dl className="settings-panel__info">
    {rows.map(([label, value]) => (
      <Fragment key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </Fragment>
    ))}
  </dl>
);

interface MapPanelViewProps {
  i18n?: I18n;
  initial: MapPanelOptions["initial"];
  rows: readonly [string, string][];
  onRecreate: MapPanelOptions["onRecreate"];
}
const MapPanelView = ({ i18n, initial, rows, onRecreate }: MapPanelViewProps) => (
  <>
    <Section icon="map" title={translateMessage(i18n, M.current.title)}>
      <IslandInfo rows={rows} />
    </Section>
    <Section icon="map" title={translateMessage(i18n, M.current.newIsland)}>
      <IslandForm i18n={i18n} initial={initial} onRecreate={onRecreate} />
    </Section>
  </>
);

/** Map generator panel: the current island (with its load time once known) and the new island form. */
export const MapPanel = ({ i18n, initial, island, loadTime, onRecreate }: MapPanelOptions) => {
  useI18nRevision(i18n);
  const rows = getMapPanelRows(island, useExternalStore(loadTime), i18n);
  return <MapPanelView i18n={i18n} initial={initial} rows={rows} onRecreate={onRecreate} />;
};

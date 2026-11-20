import type { CampaignEditor } from "../campaign-editor";
import { MapSettings } from "../map-settings/map-settings";
import { useMapsSection } from "./use-maps-section";

interface MapsSectionProps {
  editor: CampaignEditor;
}

type MapsSectionView = ReturnType<typeof useMapsSection>;

interface MapRowProps {
  editor: CampaignEditor;
  row: MapsSectionView["rows"][number];
  view: MapsSectionView;
}
/** One map of the play order: drag handle, order number, name, Ready badge, move and remove buttons. */
const MapRow = ({ editor, row, view }: MapRowProps) => (
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- drag-and-drop row; buttons: keyboard
  <li aria-current={row.selected} className="campaign-editor__map-row" data-dragging={row.dragging} draggable
    onDragEnd={view.onDragEnd} onDragOver={view.onDragOver} onDragStart={event => view.onDragStart(event, row.index)}
    onDrop={event => view.onDrop(event, row.index)}>
    <span aria-hidden="true" className="campaign-editor__drag-handle">⋮⋮</span>
    <span className="campaign-editor__order">{row.position}</span>
    <button className="campaign-editor__map-name" type="button" onClick={() => editor.selectMap(row.id)}>
      {row.name}
    </button>
    {row.ready && <span className="campaign-editor__badge" data-state="ready">{view.readyLabel}</span>}
    <span className="campaign-editor__row-actions">
      <button aria-label={row.upLabel} className="campaign-editor__icon-button" disabled={row.first} title={row.upLabel}
        type="button" onClick={() => editor.moveMap(row.index, row.index - 1)}>▲</button>
      <button aria-label={row.downLabel} className="campaign-editor__icon-button" disabled={row.last}
        title={row.downLabel} type="button" onClick={() => editor.moveMap(row.index, row.index + 1)}>▼</button>
      <button aria-label={row.removeLabel} className="campaign-editor__icon-button" title={row.removeLabel}
        type="button" onClick={() => editor.unlistMap(row.id)}>✕</button>
    </span>
  </li>
);

/** The ordered map list (sortable, add/remove), the campaign's unlisted maps and the selected map's settings. */
export const MapsSection = ({ editor }: MapsSectionProps) => {
  const view = useMapsSection(editor);
  return (
    <div className="campaign-editor__columns">
      <section aria-label={view.orderTitle} className="campaign-editor__card">
        <h3>{view.orderTitle}</h3>
        {!view.rows.length && <p className="campaign-editor__hint">{view.emptyNote}</p>}
        <ol className="campaign-editor__map-list">
          {view.rows.map(row => <MapRow editor={editor} key={row.id} row={row} view={view} />)}
        </ol>
        <button className="campaign-editor__button campaign-editor__button--primary" disabled={view.busy}
          type="button" onClick={editor.addMap}>{view.addLabel}</button>
        {view.unlisted.length > 0 && (
          <div className="campaign-editor__unlisted">
            <h4>{view.unlistedTitle}</h4>
            <ul>
              {view.unlisted.map(map => (
                <li key={map.id}>
                  <span>{map.name}</span>
                  <button className="campaign-editor__button" type="button" onClick={() => editor.listMap(map.id)}>
                    {view.listLabel}
                  </button>
                  <button className="campaign-editor__button campaign-editor__button--danger" disabled={view.busy}
                    type="button" onClick={() => editor.deleteMap(map.id)}>{view.deleteLabel}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <MapSettings editor={editor} />
    </div>
  );
};

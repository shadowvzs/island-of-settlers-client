import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { IconButton } from "../../components/icon-button";
import { SETTINGS_CHROME_MESSAGES as M } from "../chrome-messages";
import type { CameraBookmarkControls } from "./bookmark-controls";
import type { BookmarkRow } from "./helpers";
import { useCameraBookmarks } from "./use-camera-bookmarks";

interface BookmarkRowViewProps {
  row: BookmarkRow;
  onDelete: (index: number) => void;
  onGo: (index: number) => void;
}
const BookmarkRowView = ({ row: { deleteLabel, goLabel, index, name }, onDelete, onGo }: BookmarkRowViewProps) => (
  <div className="camera-control-row">
    <IconButton caption={name} icon="map" label={goLabel} onClick={() => onGo(index)} />
    <IconButton icon="cancel" label={deleteLabel} onClick={() => onDelete(index)} />
  </div>
);

interface CameraBookmarksProps {
  controls: CameraBookmarkControls;
  i18n?: I18n;
}
/** Named camera views of this island, saved with the game. */
export const CameraBookmarks = ({ controls, i18n }: CameraBookmarksProps) => {
  const { addDisabled, input, name, rows, status, onDelete, onGo, onKeyDown, onNameChange, onSave } =
    useCameraBookmarks(controls, i18n);
  return (
    <section aria-label={translateMessage(i18n, M.camera.bookmarks)} className="camera-bookmarks">
      <h3>{translateMessage(i18n, M.camera.bookmarks)}</h3>
      <input
        aria-label={translateMessage(i18n, M.camera.bookmarkName)}
        maxLength={40}
        placeholder={translateMessage(i18n, M.camera.namePlaceholder)}
        ref={input}
        value={name}
        onChange={event => onNameChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <IconButton
        caption={translateMessage(i18n, M.camera.saveView)}
        disabled={addDisabled}
        icon="map"
        label={translateMessage(i18n, M.camera.saveThisView)}
        onClick={onSave}
      />
      <div>
        {rows.map(row => <BookmarkRowView key={row.key} row={row} onDelete={onDelete} onGo={onGo} />)}
      </div>
      <p role="status">{status}</p>
    </section>
  );
};

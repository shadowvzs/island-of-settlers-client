import { RAW_IMAGE_ACCEPT } from "../constants";
import type { ImageUploadView } from "./helpers";

interface ImageUploadProps {
  view: ImageUploadView;
  onRemove?: () => void;
  onUpload: (file: File) => void;
}
/**
 * A stored campaign image (thumbnail) with its upload input; the editor processes the file to WebP.
 */
export const ImageUpload = ({ view, onRemove, onUpload }: ImageUploadProps) => (
  <div className="campaign-editor__image-upload">
    <span className="campaign-editor__label-text">{view.label}</span>
    <div className="campaign-editor__thumbnail">
      {view.url && <img alt="" decoding="async" draggable={false} src={view.url} />}
    </div>
    <label className="campaign-editor__button campaign-editor__upload" data-disabled={view.disabled}>
      {view.uploadLabel}
      <input accept={RAW_IMAGE_ACCEPT} aria-label={view.uploadAriaLabel} disabled={view.disabled} type="file"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onUpload(file);
        }} />
    </label>
    {view.removable && onRemove && (
      <button className="campaign-editor__button campaign-editor__button--quiet" type="button" onClick={onRemove}>
        {view.removeLabel}
      </button>
    )}
  </div>
);

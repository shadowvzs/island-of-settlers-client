import type { DecorationPaletteEditor } from "../decoration-palette-editor";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import type { PaletteCategoryTab, PaletteTile } from "./decoration-palette-helpers";
import {
  ActionButton, ActionRow, AuthoringControls, ChoiceField, EditorSection, NumberField, StatusText
} from "./fields";
import { type DecorationPaletteView, useDecorationPalette } from "./use-decoration-palette";

const TILE_CLASS = "map-editor__tool map-editor__palette-tile";

interface CategoryBarProps {
  categories: readonly PaletteCategoryTab[];
  label: string;
  onCategory: (id: string) => void;
}
const CategoryBar = ({ categories, label, onCategory }: CategoryBarProps) => (
  <div aria-label={label} className="map-editor__palette-categories" role="group">
    {categories.map(category => (
      <button aria-pressed={category.selected} className="map-editor__palette-category" key={category.id}
        type="button" onClick={() => onCategory(category.id)}>
        {category.label}
      </button>
    ))}
  </div>
);

interface TileFaceProps {
  tile: PaletteTile;
  onIconError: (id: string) => void;
}
const TileFace = ({ tile, onIconError }: TileFaceProps) => {
  if (!tile.icon) return <span aria-hidden="true" className="map-editor__palette-initials">{tile.initials}</span>;
  return (
    <img alt="" className="map-editor__palette-icon" draggable={false} loading="lazy" src={tile.icon.src}
      srcSet={tile.icon.srcSet} onError={() => onIconError(tile.id)} />
  );
};

interface TileGridProps {
  emptyText: string;
  label: string;
  tiles: DecorationPaletteView["tiles"];
  onIconError: (id: string) => void;
  onPick: (id: string) => void;
}
const TileGrid = ({ emptyText, label, tiles, onIconError, onPick }: TileGridProps) => (
  <div aria-label={label} className="map-editor__palette-grid" role="group">
    {tiles.map(tile => (
      <button aria-label={tile.title} aria-pressed={tile.selected} className={TILE_CLASS} data-entry={tile.id}
        key={tile.id} title={tile.title} type="button" onClick={() => onPick(tile.id)}>
        <TileFace tile={tile} onIconError={onIconError} />
      </button>
    ))}
    {tiles.length === 0 && <p className="map-editor__palette-empty">{emptyText}</p>}
  </div>
);

const PaletteOptions = ({ palette }: { palette: DecorationPaletteView }) => (
  <AuthoringControls>
    <p className="map-editor__palette-selected">{palette.selectedTitle}</p>
    <ChoiceField {...palette.variant} className="map-editor__wide-field" hidden={palette.variantOptions.length === 0}
      label={M.palette.variant} options={palette.variantOptions} />
    <NumberField {...palette.rotation} label={M.fields.decorationRotation} max={360} min={0} size="narrow" />
    {palette.scaleLimits && (
      <NumberField {...palette.scale} label={M.fields.decorationScale} max={palette.scaleLimits.max}
        min={palette.scaleLimits.min} size="narrow" step=".01" />
    )}
    <ActionRow>
      <ActionButton caption={M.captions.place} label={M.actions.placeDecoration} pressed={palette.placeActive}
        onClick={palette.onPlace} />
      <ActionButton caption={M.captions.remove} label={M.palette.removeAtClick} pressed={palette.removeActive}
        onClick={palette.onRemove} />
    </ActionRow>
  </AuthoringControls>
);

interface DecorationPaletteSectionProps {
  editor: DecorationPaletteEditor;
}
/** Every registered decoration as an icon grid: category filter, quick search, single select to place. */
export const DecorationPaletteSection = ({ editor }: DecorationPaletteSectionProps) => {
  const palette = useDecorationPalette(editor);
  return (
    <EditorSection info={M.palette.help} title={M.palette.section}>
      <div className="map-editor__palette-toolbar">
        <CategoryBar categories={palette.categories} label={palette.categoriesLabel}
          onCategory={palette.onCategory} />
        <input aria-label={palette.searchLabel} className="map-editor__palette-search"
          placeholder={palette.searchPlaceholder} type="search" value={palette.search}
          onChange={event => palette.onSearch(event.target.value)} />
      </div>
      <TileGrid emptyText={palette.emptyText} label={palette.gridLabel} tiles={palette.tiles}
        onIconError={palette.onIconError} onPick={palette.onPick} />
      <PaletteOptions palette={palette} />
      <StatusText>{palette.status}</StatusText>
    </EditorSection>
  );
};

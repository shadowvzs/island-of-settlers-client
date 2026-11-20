/** Icon files (assets/editor-icons, made by tools/assets/editor-icons.ts): name -> URL. */
const FILES = import.meta.glob<string>("../../../assets/editor-icons/*.webp", {
  eager: true,
  import: "default",
  query: "?url"
});

const toUrl = (file: string) => FILES[`../../../assets/editor-icons/${file}.webp`];

/** The icon's image sources (1x, and 2x for hi-dpi screens), or null when it was not made. */
export const getIconSources = (icon: string) => {
  const single = toUrl(icon);
  const double = toUrl(`${icon}@2x`);
  if (!single) return null;
  return { src: single, srcset: double ? `${single} 1x, ${double} 2x` : single };
};

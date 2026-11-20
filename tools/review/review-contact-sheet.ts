import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Browser } from "playwright-core";

/** A labelled tile; a null or missing `path` draws a "missing" placeholder of the row's tile size. */
export interface SheetCell {
  label: string;
  path: string | null;
}

/** A row band with its own heading; cells wrap after `columns`. */
export interface SheetRow {
  cells: SheetCell[];
  heading: string;
}

export interface SheetLayout {
  columns: number;
  rows: SheetRow[];
  title: string;
  /** Sheet width in pixels (default 2400). */
  width?: number;
}

interface PageLayout {
  columns: number;
  rows: { cells: { image: string | null; label: string }[]; heading: string }[];
  title: string;
  width: number;
}

const readImage = (path: string | null) => (path && existsSync(path) ? readFileSync(path).toString("base64") : null);

/**
 * Draws the sheet on a page canvas (the generalised visual-acceptance `sheet.py`: title, golden row
 * headings, black label tabs on each tile) and returns it as base64 PNG. Runs in the browser.
 */
const drawSheet = async ({ columns, rows, title, width }: PageLayout) => {
  const GAP = 6, TITLE = 48, BAND = 30, TAB = 26;
  const cellWidth = Math.floor((width - GAP * (columns + 1)) / columns);
  const load = (base64: string) => new Promise<HTMLImageElement>((done, failed) => {
    const image = new Image();
    image.onload = () => done(image); image.onerror = failed;
    image.src = `data:image/png;base64,${base64}`;
  });
  const loaded = await Promise.all(rows.map(row => Promise.all(row.cells.map(async cell =>
    ({ image: cell.image ? await load(cell.image) : null, label: cell.label })))));
  const tileHeight = (image: HTMLImageElement | null) =>
    image ? Math.round(image.naturalHeight * cellWidth / image.naturalWidth) : Math.round(cellWidth * .625);
  const chunks = loaded.flatMap((cells, row) => cells.reduce<{ cells: typeof cells; heading: string }[]>(
    (list, cell, index) => {
      if (index % columns === 0) list.push({ cells: [], heading: index === 0 ? rows[row]!.heading : "" });
      list.at(-1)!.cells.push(cell);
      return list;
    }, []));
  const chunkHeight = (cells: typeof loaded[number]) => Math.max(...cells.map(cell => tileHeight(cell.image)));
  const height = chunks.reduce((sum, chunk) => sum + (chunk.heading ? BAND : 0) + chunkHeight(chunk.cells) + GAP,
    TITLE + GAP);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#1c1e22"; context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff"; context.font = "bold 24px sans-serif"; context.fillText(title, GAP * 2, 32);
  let y = TITLE;
  for (const chunk of chunks) {
    if (chunk.heading) {
      context.fillStyle = "#ffd678"; context.font = "bold 18px sans-serif";
      context.fillText(chunk.heading, GAP * 2, y + 21); y += BAND;
    }
    chunk.cells.forEach((cell, index) => {
      const x = GAP + index * (cellWidth + GAP), tile = tileHeight(cell.image);
      if (cell.image) {
        context.drawImage(cell.image, x, y, cellWidth, tile);
      } else {
        context.fillStyle = "#3a2020"; context.fillRect(x, y, cellWidth, tile);
        context.fillStyle = "#f88"; context.font = "16px sans-serif"; context.fillText("missing", x + 12, y + 50);
      }
      context.font = "16px sans-serif";
      const tab = context.measureText(cell.label).width + 14;
      context.fillStyle = "rgba(0,0,0,.8)"; context.fillRect(x, y, tab, TAB);
      context.fillStyle = "#fff"; context.fillText(cell.label, x + 7, y + 18);
    });
    y += chunkHeight(chunk.cells) + GAP;
  }
  return canvas.toDataURL("image/png").split(",")[1]!;
};

/** Writes the labelled contact sheet PNG of `layout` to `file`. */
export const writeContactSheet = async (browser: Browser, layout: SheetLayout, file: string) => {
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><body></body>");
    await page.evaluate("window.__name = value => value;");
    const rows = layout.rows.map(row => ({ cells: row.cells.map(cell => ({ image: readImage(cell.path),
      label: cell.label })), heading: row.heading }));
    const png = await page.evaluate(drawSheet, { columns: layout.columns, rows, title: layout.title,
      width: layout.width ?? 2400 });
    writeFileSync(file, Buffer.from(png, "base64"));
  } finally { await page.close(); }
};

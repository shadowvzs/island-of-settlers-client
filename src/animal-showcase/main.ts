import { loadAnimalModels } from "../render-common/wildlife/model/animal-asset-loader";
import { SHEETS } from "./sheet-layouts";
import { createSheetRenderer } from "./sheet-renderer";

import "./sheet.css";

declare global {
  interface Window {
    /** Set after the sheet rendered (Playwright export). */
    __sheetReady?: boolean;
    /** The current sheet as an RGBA PNG data URL. */
    __sheetPng?: () => string;
  }
}

/** ?sheet=elk|deer|gaits|rabbit|rabbits|resting|stages presets the sheet; ?winter=1 the coats. */
const readSheet = (search: string) => {
  const name = new URLSearchParams(search).get("sheet") ?? "elk";
  return name in SHEETS ? name : "elk";
};

const createButton = (text: string, onClick: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
};

/** Downloads the sheet canvas as a transparent PNG. */
const exportPng = (canvas: HTMLCanvasElement, name: string) => {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${name}-sheet.png`;
  link.click();
};

const start = async () => {
  const canvas = document.getElementById("sheet") as HTMLCanvasElement;
  const winter = new URLSearchParams(location.search).get("winter") === "1";
  const sheet = createSheetRenderer(canvas, await loadAnimalModels(), winter);
  let current = readSheet(location.search);
  const show = (name: string) => {
    current = name;
    sheet.render(SHEETS[name]!);
  };
  document.getElementById("controls")!.append(
    ...Object.keys(SHEETS).map((name) => createButton(name, () => show(name))),
    createButton("Export PNG", () => exportPng(canvas, current))
  );
  show(current);
  window.__sheetPng = () => canvas.toDataURL("image/png");
  window.__sheetReady = true;
};

void start();

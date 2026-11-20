import { getGlIssues, onGlIssue, reportGlIssue } from "../../render-common/gl-diagnostics";
import { type GlInfoSection,readGlInfo } from "./gl-debug-info";

export { installGlDebugHooks } from "./gl-debug-hooks";
export { installMaliEmulation } from "./gl-emulation";

const STYLE = `
.gl-debug {
  position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 50; max-height: 60vh;
  overflow: auto; padding: 8px 10px; border-radius: 6px; background: rgb(0 0 0 / 82%);
  color: #e8f0f6; font: 11px/1.35 monospace;
}
.gl-debug pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
.gl-debug__issues { color: #ffb4a8; }
.gl-debug button { margin: 0 6px 6px 0; font: inherit; }
`;

const formatSection = ({ rows, title }: GlInfoSection) =>
  [`== ${title}`, ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");

const formatIssues = () => {
  const issues = getGlIssues();
  if (issues.length === 0) return "== GL problems\nnone";
  const lines = issues.map(({ kind, log, name }) => `[${kind}] ${name}\n${log.trim()}`);
  return ["== GL problems", ...lines].join("\n");
};

const createButton = (label: string, onClick: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

/**
 * ?gldebug=1: GPU, WebGL version, key limits, precision formats, extensions and every GL problem
 * of this run (shader builds, texture uploads, ground fallback, context loss), as plain text a
 * phone screenshot captures. "copy" puts the text on the clipboard; "hide" folds it.
 * @public Called on the dynamically imported module in main.ts, which knip cannot trace.
 */
export const showGlDebugView = (
  container: HTMLElement,
  gl: WebGL2RenderingContext,
  layerSize: number
) => {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const panel = document.createElement("div");
  panel.className = "gl-debug";
  const info = document.createElement("pre");
  info.textContent = readGlInfo(gl, layerSize).map(formatSection).join("\n");
  const issues = document.createElement("pre");
  issues.className = "gl-debug__issues";
  const render = () => {
    issues.textContent = formatIssues();
  };
  const copy = () =>
    void navigator.clipboard?.writeText(`${issues.textContent}\n${info.textContent}`);
  const toggle = () => {
    info.hidden = !info.hidden;
    issues.hidden = info.hidden;
  };
  panel.append(createButton("copy", copy), createButton("hide / show", toggle), issues, info);
  container.append(style, panel);
  gl.canvas.addEventListener("webglcontextlost", () =>
    reportGlIssue({ kind: "context", log: "webglcontextlost", name: "WebGL context lost" })
  );
  onGlIssue(render);
  render();
};

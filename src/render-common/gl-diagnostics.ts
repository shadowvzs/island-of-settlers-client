/**
 * GL problems seen this run (shader builds, texture uploads, ground fallbacks): renderers report
 * them here at no cost; the ?gldebug=1 view (app/gl-debug) lists them, so a phone screenshot is
 * enough to diagnose a GPU.
 */
export interface GlIssue {
  kind: "ground" | "shader" | "texture" | "context";
  log: string;
  name: string;
}

const issues: GlIssue[] = [];
const listeners = new Set<() => void>();

/** Driver logs can end in NUL characters (drawn as boxes). */
const cleanLog = (log: string) => log.replaceAll("\0", "").trim();

export const reportGlIssue = (issue: GlIssue) => {
  issues.push({ ...issue, log: cleanLog(issue.log) });
  for (const listener of listeners) listener();
};

export const getGlIssues = (): readonly GlIssue[] => issues;

/** Calls the listener after every new issue; returns the unsubscribe. */
export const onGlIssue = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A shader's name for the reports: its SHADER_NAME define, else its first declaration. */
export const readShaderName = (source: string) => {
  const defined = /#define SHADER_NAME (.+)/.exec(source)?.[1];
  if (defined) return defined.trim();
  const declaration = /^\s*(?:uniform|in|out)\s+\w+\s+\w+/m.exec(source)?.[0];
  return declaration ? `shader with "${declaration.trim()}"` : "unnamed shader";
};

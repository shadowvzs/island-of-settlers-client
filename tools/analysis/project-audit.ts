import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resourcesPath } from "../bench/resources-path";

const root = resolve(import.meta.dirname, "../..");
/** The game repository root (README, CLAUDE.md and docs/ stay beside island-of-settlers-client/). */
const repoRoot = resolve(root, "..");
const filesIn = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(folder, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? filesIn(path) : [path];
  });

/** Check local Markdown destinations; remote URLs and same-page anchors are separate concerns. */
const brokenLinks = (file: string) => {
  const text = readFileSync(file, "utf8");
  const issues: { file: string; line: number; target: string }[] = [];
  for (const match of text.matchAll(/\]\((<[^>]+>|[^)\n]+)\)/g)) {
    const target = match[1]!.trim().replace(/^<|>$/g, "");
    if (/^[a-zA-Z][\w+.-]*:/.test(target) || target.startsWith("#")) continue;
    const path = decodeURIComponent(target.split("#")[0]!);
    if (existsSync(resolve(dirname(file), path))) continue;
    issues.push({
      file: relative(repoRoot, file),
      line: text.slice(0, match.index).split("\n").length,
      target
    });
  }
  return issues;
};

export const AUDIT_USAGE = `Usage: npx tsx tools/analysis/project-audit.ts [options]

Checks local Markdown destinations, review assets under island-of-settlers-client/assets and the
largest TypeScript/TSX modules under island-of-settlers-client/src. It does not validate prose,
remote links, same-page anchors or runtime reachability.

Options:
  --output <directory>  Write the receipt to this directory (relative to the
                        current working directory). Default: the workspace
                        resources/project-reviews/<date> folder.
  --date <YYYY-MM-DD>   Audit date label and default output folder. Defaults
                        to the current UTC date.
  --dry-run             Print the summary without writing a receipt.
  --help                Show this help.

An existing receipt is never overwritten: structure-audit.json becomes
structure-audit-2.json, then structure-audit-3.json, and so on.`;

export interface AuditArguments {
  date: string;
  dryRun: boolean;
  help: boolean;
  output?: string;
}

const utcDate = () => new Date().toISOString().slice(0, 10);

const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export const parseAuditArguments = (args: readonly string[]): AuditArguments => {
  const parsed: AuditArguments = { date: utcDate(), dryRun: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const equals = argument.indexOf("=");
    const flag = equals >= 0 ? argument.slice(0, equals) : argument;
    const inline = equals >= 0 ? argument.slice(equals + 1) : undefined;
    if (flag === "--output" || flag === "--date") {
      const value = inline ?? args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value.\n\n${AUDIT_USAGE}`);
      }
      if (inline === undefined) index += 1;
      if (flag === "--output") parsed.output = value;
      else parsed.date = value;
      continue;
    }
    if (inline !== undefined) throw new Error(`Unknown argument: ${argument}\n\n${AUDIT_USAGE}`);
    if (flag === "--dry-run") parsed.dryRun = true;
    else if (flag === "--help" || flag === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${argument}\n\n${AUDIT_USAGE}`);
  }
  if (!validDate(parsed.date)) {
    throw new Error(`Invalid --date (expected YYYY-MM-DD): ${parsed.date}`);
  }
  return parsed;
};

/** Write with an exclusive create so concurrent or repeated runs preserve every receipt. */
export const writeUniqueReceipt = (directory: string, report: unknown): string => {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(directory, { recursive: true });
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? "structure-audit.json" : `structure-audit-${index}.json`;
    const path = resolve(directory, name);
    try {
      writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
};

const displayPath = (path: string) => {
  const relativePath = relative(repoRoot, path);
  if (relativePath === "") return ".";
  return relativePath.startsWith("..") ? path : relativePath.split("\\").join("/");
};

/** Command-line paths should be shown relative to the directory the command ran in. */
const invocationPath = (path: string) => {
  const relativePath = relative(process.cwd(), path);
  if (relativePath === "") return ".";
  return relativePath.startsWith("..") ? path : relativePath.split("\\").join("/");
};

const digestFiles = (files: readonly string[], pathRoot: string) => {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(relative(pathRoot, file).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const fileIdentity = (file: string, pathRoot: string) => {
  const contents = readFileSync(file);
  return {
    file: relative(pathRoot, file).split("\\").join("/"),
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
};

export const collectModuleSizes = (clientRoot: string, limit = 15) =>
  filesIn(resolve(clientRoot, "src"))
    .filter((file) => /\.(ts|tsx)$/i.test(file))
    .map((file) => ({
      file: relative(clientRoot, file).split("\\").join("/"),
      lines: readFileSync(file, "utf8").split("\n").length - 1
    }))
    .sort((first, second) => second.lines - first.lines || first.file.localeCompare(second.file))
    .slice(0, limit);

const collectReviewAssets = (clientRoot: string) =>
  filesIn(resolve(clientRoot, "assets"))
    .filter((file) => /[\\/]review[^\\/]*[\\/]/.test(file))
    .map((file) => relative(clientRoot, file).split("\\").join("/"))
    .sort();

const actualNpmScript = () => {
  const event = process.env.npm_lifecycle_event;
  return event && event !== "npx" ? event : null;
};

const gitOutput = (...args: string[]) => {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
};

const sourceIdentity = (files: readonly string[]) => {
  const revision = gitOutput("rev-parse", "HEAD");
  const branch = gitOutput("rev-parse", "--abbrev-ref", "HEAD");
  const status = gitOutput("status", "--porcelain", "--untracked-files=normal");
  return {
    root: "island-of-settlers-client/src",
    revision,
    branch,
    dirty: status === null ? null : status.length > 0,
    dirtyFiles: status ? status.split("\n").filter(Boolean) : [],
    digestAlgorithm: "sha256" as const,
    digest: digestFiles(files, repoRoot),
    files: files.length,
    extensions: files.reduce<Record<string, number>>((counts, file) => {
      const extension = extname(file).toLowerCase();
      counts[extension] = (counts[extension] ?? 0) + 1;
      return counts;
    }, {})
  };
};

export const AUDIT_SCOPE = {
  documentation: {
    included: ["README.md", "CLAUDE.md", "island-of-settlers-client/CREDITS.md", "docs/**/*.md (case-insensitive)"],
    excluded: [
      "other Markdown files",
      "remote URLs",
      "same-page anchors",
      "plain-text paths",
      "symlinked files and folders (not traversed)"
    ],
    check: "local Markdown link destinations only"
  },
  reviewAssets: {
    included: ["files under island-of-settlers-client/assets/** with a path segment containing 'review'"],
    excluded: ["all other island-of-settlers-client/assets files", "symlinked files and folders (not traversed)"],
    check: "paths only; no file is moved or deleted"
  },
  moduleSize: {
    included: [".ts", ".tsx"],
    excluded: [
      "island-of-settlers-client/tools",
      "island-of-settlers-client/tests",
      "island-of-settlers-client/tests-ui",
      "other repositories",
      "non-source assets",
      "symlinked files and folders (not traversed)"
    ],
    roots: ["island-of-settlers-client/src"],
    metric: "newline count (physical lines for newline-terminated files), top 15 descending",
    caution:
      "line count alone is not a defect or a deletion criterion; " +
      "generated/data-heavy modules are retained"
  }
} as const;

export interface StructureAuditReport {
  checkedDocs: number;
  brokenLinks: { file: string; line: number; target: string }[];
  reviewAssets: string[];
  longestModules: { file: string; lines: number }[];
  provenance: {
    auditDate: string;
    generatedAt: string;
    command: {
      invocation: string;
      argv: string[];
      cwd: string;
      npmScript: string | null;
      node: string;
    };
    source: {
      root: string;
      revision: string | null;
      branch: string | null;
      dirty: boolean | null;
      dirtyFiles: string[];
      digestAlgorithm: "sha256";
      digest: string;
      files: number;
      extensions: Record<string, number>;
    };
    inputs: {
      documentation: { files: number; digest: string };
      reviewAssets: {
        files: number;
        digest: string;
        entries: { file: string; bytes: number; sha256: string }[];
      };
    };
  };
  scope: typeof AUDIT_SCOPE;
}

const quoted = (value: string) => (/\s/.test(value) ? JSON.stringify(value) : value);

const buildReport = (date: string): StructureAuditReport => {
  const docs = [
    ...["README.md", "CLAUDE.md"].map((name) => resolve(repoRoot, name)),
    resolve(root, "CREDITS.md"),
    ...filesIn(resolve(repoRoot, "docs")).filter((file) => extname(file).toLowerCase() === ".md")
  ];
  const links = docs.flatMap(brokenLinks);
  const reviewAssets = collectReviewAssets(root);
  const reviewFiles = reviewAssets.map((file) => resolve(root, file));
  const sourceFiles = filesIn(resolve(root, "src")).filter((file) => /\.(ts|tsx)$/i.test(file));
  const longestModules = collectModuleSizes(root);
  const script = invocationPath(fileURLToPath(import.meta.url));
  return {
    checkedDocs: docs.length,
    brokenLinks: links,
    reviewAssets,
    longestModules,
    provenance: {
      auditDate: date,
      generatedAt: new Date().toISOString(),
      command: {
        invocation: ["npx", "tsx", script, ...process.argv.slice(2)].map(quoted).join(" "),
        argv: process.argv.slice(2),
        cwd: displayPath(process.cwd()),
        npmScript: actualNpmScript(),
        node: process.version
      },
      source: sourceIdentity(sourceFiles),
      inputs: {
        documentation: { files: docs.length, digest: digestFiles(docs, repoRoot) },
        reviewAssets: {
          files: reviewAssets.length,
          digest: digestFiles(reviewFiles, root),
          entries: reviewFiles.sort().map((file) => fileIdentity(file, root))
        }
      }
    },
    scope: AUDIT_SCOPE
  };
};

const main = () => {
  const args = parseAuditArguments(process.argv.slice(2));
  if (args.help) {
    console.log(AUDIT_USAGE);
    return;
  }
  const output = args.output
    ? resolve(process.cwd(), args.output)
    : resourcesPath("project-reviews", args.date);
  const report = buildReport(args.date);
  console.log(
    `Checked ${report.checkedDocs} documents: ${report.brokenLinks.length} broken links, ` +
      `${report.reviewAssets.length} review assets.`
  );
  console.log(
    "Largest TS/TSX modules under island-of-settlers-client/src for future review " +
      "(line count alone is not a defect):",
    report.longestModules
  );
  const source = report.provenance.source;
  console.log(
    `Source ${source.revision ?? "unknown"}${source.dirty ? " (dirty)" : ""}; ` +
      `module digest ${source.digest}; ${source.files} files ` +
      `(${source.extensions[".ts"] ?? 0} TS, ${source.extensions[".tsx"] ?? 0} TSX).`
  );
  if (args.dryRun) {
    console.log(`Dry run: no receipt written (output directory: ${displayPath(output)}).`);
  } else {
    console.log(`Wrote ${displayPath(writeUniqueReceipt(output, report))}.`);
  }
  if (report.brokenLinks.length || report.reviewAssets.length) process.exitCode = 1;
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

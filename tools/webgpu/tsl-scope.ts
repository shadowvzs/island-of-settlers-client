/**
 * Pitfall P33 detector: the node builder assigns a shared node's variable where the node is first
 * built. When that is inside an `If`/`Loop` body, every read outside the body uses an unset
 * variable (0 or garbage). This scans a generated GLSL/WGSL `main` for variables read without an
 * assignment in the same or an enclosing block (an assignment in both arms of an if/else counts
 * for the enclosing block).
 */
export interface UnscopedRead {
  /** 1-based line inside the scanned source. */
  line: number;
  text: string;
  variable: string;
}

interface Block {
  assigned: Set<string>;
  elseOf: Block | null;
}

const VARIABLE = /\bnodeVar\d+/g;
const ASSIGNMENT = /^\s*(nodeVar\d+)\s*=(?!=)/;

const entryOffset = (source: string) => {
  const glsl = source.indexOf("void main");
  if (glsl >= 0) return glsl;
  const wgsl = source.search(/fn main\s*\(/);
  return Math.max(wgsl, 0);
};

const isAssignedInScope = (stack: readonly Block[], variable: string) =>
  stack.some(block => block.assigned.has(variable));

/** Closes a block; an else arm passes the variables both arms assign to the parent. */
const closeBlock = (stack: Block[], lastClosed: Map<Block, Block>) => {
  const block = stack.pop()!;
  const parent = stack[stack.length - 1]!;
  lastClosed.set(parent, block);
  if (block.elseOf === null) return;
  for (const variable of block.assigned)
    if (block.elseOf.assigned.has(variable)) parent.assigned.add(variable);
};

const openBlock = (stack: Block[], lastClosed: Map<Block, Block>, isElse: boolean) => {
  const parent = stack[stack.length - 1]!;
  stack.push({ assigned: new Set(), elseOf: isElse ? lastClosed.get(parent) ?? null : null });
};

/** The first unscoped read of every affected variable, in source order. */
export const findUnscopedReads = (source: string): UnscopedRead[] => {
  const offset = entryOffset(source);
  const firstLine = source.slice(0, offset).split("\n").length;
  const stack: Block[] = [{ assigned: new Set(), elseOf: null }];
  const lastClosed = new Map<Block, Block>();
  const reported = new Map<string, UnscopedRead>();
  source.slice(offset).split("\n").forEach((line, index) => {
    const code = line.split("//")[0]!;
    if (/^\s*var\s/.test(code)) return;
    const assignment = ASSIGNMENT.exec(code);
    const reads = assignment ? code.slice(assignment[0].length) : code;
    for (const variable of reads.match(VARIABLE) ?? []) {
      if (reported.has(variable) || isAssignedInScope(stack, variable)) continue;
      reported.set(variable, { line: firstLine + index, text: line.trim(), variable });
    }
    if (assignment) stack[stack.length - 1]!.assigned.add(assignment[1]!);
    for (let column = 0; column < code.length; column++) {
      if (code[column] === "{") openBlock(stack, lastClosed, code.slice(0, column).includes("else"));
      else if (code[column] === "}" && stack.length > 1) closeBlock(stack, lastClosed);
    }
  });
  return [...reported.values()];
};

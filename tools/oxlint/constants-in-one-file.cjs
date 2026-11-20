"use strict";

/** Module-level constants and enums belong in one dedicated file per module/feature. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;
const DEDICATED_FILE = /(?:^|\/)constants\.tsx?$/;

const filenameOf = (context) =>
  String(context.filename ?? context.getFilename?.() ?? "").replace(/\\/g, "/");

const topLevel = (node) => {
  if (node.parent?.type === "Program") return true;
  return node.parent?.type === "ExportNamedDeclaration" && node.parent.parent?.type === "Program";
};

module.exports = {
  meta: { name: "constants" },
  rules: {
    "in-one-file": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Keep module constants and enums in the feature's constants.ts file."
        },
        messages: {
          move: "Move module constants and enums into the feature's single constants.ts file."
        }
      },
      create(context) {
        if (DEDICATED_FILE.test(filenameOf(context))) return {};
        return {
          TSEnumDeclaration(node) {
            if (topLevel(node)) context.report({ node, messageId: "move" });
          },
          VariableDeclaration(node) {
            if (node.kind !== "const" || !topLevel(node)) return;
            if (node.declarations.length === 0) return;
            const allConstants = node.declarations.every(
              (declaration) =>
                declaration.id.type === "Identifier" && CONSTANT_NAME.test(declaration.id.name)
            );
            if (allConstants) context.report({ node, messageId: "move" });
          }
        };
      }
    }
  }
};

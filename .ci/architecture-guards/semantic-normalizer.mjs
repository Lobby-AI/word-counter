import {
  isWordAt,
  consumeQuotedString,
  consumeLineComment,
  consumeBlockComment,
  consumeTemplateLiteral,
  consumeBalancedBraces,
  skipWhitespaceAndComments,
} from "./lexer-utils.mjs";

function replaceRangesPreservingNewlines(source, ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return source;

  const normalizedRanges = ranges
    .map(([start, end]) => [
      Number.isInteger(start) ? start : 0,
      Number.isInteger(end) ? end : 0,
    ])
    .map(([start, end]) => [Math.max(0, start), Math.max(0, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  if (normalizedRanges.length === 0) return source;

  const merged = [];
  for (const [start, end] of normalizedRanges) {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) {
      merged.push([start, end]);
    } else if (end > last[1]) {
      last[1] = end;
    }
  }

  let out = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    const safeStart = Math.min(source.length, Math.max(cursor, start));
    const safeEnd = Math.min(source.length, Math.max(safeStart, end));
    out += source.slice(cursor, safeStart);
    out += source.slice(safeStart, safeEnd).replace(/[^\n]/g, " ");
    cursor = safeEnd;
  }
  out += source.slice(cursor);
  return out;
}

function stripCommentsPreservingLines(source) {
  const chars = source.split("");
  const result = [];
  let i = 0;
  let state = "normal";
  let escaped = false;
  const templateExpressionDepths = [];

  while (i < chars.length) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (state === "line-comment") {
      if (ch === "\n") {
        result.push("\n");
        state = "normal";
      } else {
        result.push(" ");
      }
      i += 1;
      continue;
    }

    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        result.push(" ", " ");
        i += 2;
        state = "normal";
        continue;
      }

      result.push(ch === "\n" ? "\n" : " ");
      i += 1;
      continue;
    }

    if (state === "single-quote" || state === "double-quote") {
      result.push(ch);

      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && ch === "'")
        || (state === "double-quote" && ch === "\"")
      ) {
        state = "normal";
      }

      i += 1;
      continue;
    }

    if (state === "template") {
      if (escaped) {
        result.push(ch);
        escaped = false;
        i += 1;
        continue;
      }

      if (ch === "\\") {
        result.push(ch);
        escaped = true;
        i += 1;
        continue;
      }

      if (ch === "$" && next === "{") {
        result.push("$", "{");
        templateExpressionDepths.push(1);
        state = "normal";
        i += 2;
        continue;
      }

      result.push(ch);
      if (ch === "`") {
        state = "normal";
      }
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      result.push(" ", " ");
      i += 2;
      state = "line-comment";
      continue;
    }

    if (ch === "/" && next === "*") {
      result.push(" ", " ");
      i += 2;
      state = "block-comment";
      continue;
    }

    if (ch === "'" || ch === "\"" || ch === "`") {
      state =
        ch === "'" ? "single-quote"
          : ch === "\"" ? "double-quote"
            : "template";
      escaped = false;
      result.push(ch);
      i += 1;
      continue;
    }

    result.push(ch);

    if (templateExpressionDepths.length > 0) {
      const top = templateExpressionDepths.length - 1;
      if (ch === "{") {
        templateExpressionDepths[top] += 1;
      } else if (ch === "}") {
        templateExpressionDepths[top] -= 1;
        if (templateExpressionDepths[top] === 0) {
          templateExpressionDepths.pop();
          state = "template";
        }
      }
    }

    i += 1;
  }

  return result.join("");
}

function stripImportDeclarationsWithAst(source, TS) {
  if (!TS) return null;

  let sourceFile;
  try {
    sourceFile = TS.createSourceFile(
      "semantic-duplicate.tsx",
      source,
      TS.ScriptTarget.Latest,
      true,
      TS.ScriptKind.TSX,
    );
  } catch {
    return null;
  }

  const ranges = [];
  const pushRange = (node) => {
    ranges.push([node.getFullStart(), node.getEnd()]);
  };

  const visit = (node) => {
    if (TS.isImportDeclaration(node) || TS.isImportEqualsDeclaration(node)) {
      pushRange(node);
    } else if (TS.isExportDeclaration(node) && node.isTypeOnly) {
      pushRange(node);
    }
    TS.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (ranges.length === 0) return source;
  return replaceRangesPreservingNewlines(source, ranges);
}

function findKeywordOutsideNesting(source, startIndex, keyword) {
  let i = startIndex;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "'" || ch === "\"") {
      const strEnd = consumeQuotedString(source, i);
      if (strEnd == null) return null;
      i = strEnd;
      continue;
    }

    if (ch === "`") {
      const templateEnd = consumeTemplateLiteral(source, i);
      if (templateEnd == null) return null;
      i = templateEnd;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      const lineCommentEnd = consumeLineComment(source, i);
      if (lineCommentEnd == null) return null;
      i = lineCommentEnd;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const blockCommentEnd = consumeBlockComment(source, i);
      if (blockCommentEnd == null) return null;
      i = blockCommentEnd;
      continue;
    }

    if (ch === "{") {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) return null;
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }

    if (ch === "[") {
      bracketDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      i += 1;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      i += 1;
      continue;
    }

    if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      if (isWordAt(source, i, keyword)) return i;
      if (ch === ";") return null;
    }

    i += 1;
  }

  return null;
}

function consumeOptionalImportAttributes(source, index) {
  let i = skipWhitespaceAndComments(source, index);
  if (i == null) return null;

  let keywordLength = 0;
  if (isWordAt(source, i, "with")) keywordLength = 4;
  else if (isWordAt(source, i, "assert")) keywordLength = 6;
  if (keywordLength === 0) return i;

  i += keywordLength;
  i = skipWhitespaceAndComments(source, i);
  if (i == null || source[i] !== "{") return null;
  return consumeBalancedBraces(source, i);
}

function consumeStatementTerminator(source, index) {
  let i = index;
  let hasSemicolon = false;
  if (source[i] === ";") {
    hasSemicolon = true;
    i += 1;
  }

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\n" || ch === "\r") return i;
    if (ch === " " || ch === "\t" || ch === "\f" || ch === "\v") {
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      return consumeLineComment(source, i);
    }

    if (ch === "/" && source[i + 1] === "*") {
      const blockCommentEnd = consumeBlockComment(source, i);
      if (blockCommentEnd == null) return null;
      i = blockCommentEnd;
      continue;
    }

    if (hasSemicolon) return i;
    return null;
  }

  return i;
}

function consumeImportDeclarationEnd(source, startIndex) {
  if (!isWordAt(source, startIndex, "import")) return null;
  let i = startIndex + 6;

  i = skipWhitespaceAndComments(source, i);
  if (i == null || i >= source.length) return null;

  // `import(...)` と `import.meta` は宣言ではないため除去しない。
  if (source[i] === "(" || source[i] === ".") return null;

  // side-effect import: `import "module"`
  if (source[i] === "'" || source[i] === "\"") {
    i = consumeQuotedString(source, i);
    if (i == null) return null;
    i = consumeOptionalImportAttributes(source, i);
    if (i == null) return null;
    return consumeStatementTerminator(source, i);
  }

  const fromIndex = findKeywordOutsideNesting(source, i, "from");
  if (fromIndex == null) return null;
  i = fromIndex + 4;

  i = skipWhitespaceAndComments(source, i);
  if (i == null || (source[i] !== "'" && source[i] !== "\"")) return null;

  i = consumeQuotedString(source, i);
  if (i == null) return null;
  i = consumeOptionalImportAttributes(source, i);
  if (i == null) return null;
  return consumeStatementTerminator(source, i);
}

function consumeExportTypeDeclarationEnd(source, startIndex) {
  if (!isWordAt(source, startIndex, "export")) return null;
  let i = startIndex + 6;

  i = skipWhitespaceAndComments(source, i);
  if (i == null || !isWordAt(source, i, "type")) return null;
  i += 4;

  const fromIndex = findKeywordOutsideNesting(source, i, "from");
  if (fromIndex == null) return null;
  i = fromIndex + 4;

  i = skipWhitespaceAndComments(source, i);
  if (i == null || (source[i] !== "'" && source[i] !== "\"")) return null;

  i = consumeQuotedString(source, i);
  if (i == null) return null;
  i = consumeOptionalImportAttributes(source, i);
  if (i == null) return null;
  return consumeStatementTerminator(source, i);
}

function stripImportDeclarationsConservatively(source) {
  const ranges = [];
  let index = 0;

  while (index < source.length) {
    const lineStart = index;
    const lineEndRaw = source.indexOf("\n", index);
    const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw;

    let tokenStart = lineStart;
    while (tokenStart < lineEnd && (source[tokenStart] === " " || source[tokenStart] === "\t")) {
      tokenStart += 1;
    }

    let declarationEnd = null;
    if (isWordAt(source, tokenStart, "import")) {
      declarationEnd = consumeImportDeclarationEnd(source, tokenStart);
    } else if (isWordAt(source, tokenStart, "export")) {
      declarationEnd = consumeExportTypeDeclarationEnd(source, tokenStart);
    }

    if (declarationEnd != null && declarationEnd > tokenStart) {
      ranges.push([lineStart, declarationEnd]);
      index = declarationEnd;
      continue;
    }

    if (lineEndRaw === -1) break;
    index = lineEndRaw + 1;
  }

  if (ranges.length === 0) return source;
  return replaceRangesPreservingNewlines(source, ranges);
}

function stripImportDeclarationsForSemanticDuplicate(source, TS) {
  const astStripped = stripImportDeclarationsWithAst(source, TS);
  if (astStripped != null) return astStripped;
  return stripImportDeclarationsConservatively(source);
}

export function normalizeForSemanticDuplicate(source, { TS } = {}) {
  let s = source.replace(/\r\n/g, "\n");

  // Remove comments while preserving string/template contents.
  s = stripCommentsPreservingLines(s);

  // Remove import/export type declarations for anti hash-shift normalization.
  s = stripImportDeclarationsForSemanticDuplicate(s, TS);

  // Ignore simple console calls used for hash-shifting noise.
  s = s.replace(/^\s*console\.[A-Za-z_$][\w$]*\([^\n]*\)\s*;?\s*$/gm, "");

  // Normalize exported/local function names so renaming does not evade detection.
  s = s.replace(/\bexport\s+(async\s+)?function\s+[A-Za-z_$][\w$]*/g, "export $1function __FN__");
  s = s.replace(/\bexport\s+default\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)?/g, "export default $1function __FN__");
  s = s.replace(/\basync\s+function\s+[A-Za-z_$][\w$]*/g, "async function __FN__");
  s = s.replace(/\bfunction\s+[A-Za-z_$][\w$]*/g, "function __FN__");
  s = s.replace(/\bexport\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?\(/g, "export const __FN__ = $1(");
  s = s.replace(/\bconst\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?\(/g, "const __FN__ = $1(");
  s = s.replace(/\bclass\s+[A-Za-z_$][\w$]*/g, "class __CLASS__");

  // Canonical whitespace.
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

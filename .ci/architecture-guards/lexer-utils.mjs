export function isIdentifierStartChar(ch) {
  return /[A-Za-z_$]/u.test(ch ?? "");
}

export function isIdentifierPartChar(ch) {
  return /[A-Za-z0-9_$]/u.test(ch ?? "");
}

export function isWordAt(source, index, word) {
  if (index < 0 || !source.startsWith(word, index)) return false;
  const prev = source[index - 1];
  const next = source[index + word.length];
  if (isIdentifierPartChar(prev) || isIdentifierPartChar(next)) return false;
  return true;
}

export function consumeQuotedString(source, index) {
  const quote = source[index];
  if (quote !== "'" && quote !== "\"") return null;

  let i = index + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\n" || ch === "\r") return null;
    i += 1;
  }
  return null;
}

export function consumeLineComment(source, index) {
  if (source[index] !== "/" || source[index + 1] !== "/") return null;
  let i = index + 2;
  while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
    i += 1;
  }
  return i;
}

export function consumeBlockComment(source, index) {
  if (source[index] !== "/" || source[index + 1] !== "*") return null;
  const end = source.indexOf("*/", index + 2);
  if (end === -1) return null;
  return end + 2;
}

export function consumeBalancedBraces(source, index) {
  if (source[index] !== "{") return null;

  let depth = 0;
  let i = index;
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
      depth += 1;
      i += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return i;
      continue;
    }

    i += 1;
  }
  return null;
}

export function consumeTemplateLiteral(source, index) {
  if (source[index] !== "`") return null;

  let i = index + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && source[i + 1] === "{") {
      const expressionEnd = consumeBalancedBraces(source, i + 1);
      if (expressionEnd == null) return null;
      i = expressionEnd;
      continue;
    }
    i += 1;
  }
  return null;
}

export function skipWhitespaceAndComments(source, index) {
  let i = index;
  while (i < source.length) {
    const ch = source[i];

    if (/\s/u.test(ch)) {
      i += 1;
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

    break;
  }

  return i;
}

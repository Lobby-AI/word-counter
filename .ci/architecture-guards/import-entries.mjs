import path from "path";
import {
  isIdentifierStartChar,
  isIdentifierPartChar,
} from "./lexer-utils.mjs";

const REGEX_LITERAL_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function isAsciiLetter(ch) {
  return /[A-Za-z]/u.test(ch ?? "");
}

function findRegexLiteralEnd(chars, startIndex) {
  if (chars[startIndex] !== "/") return null;

  let i = startIndex + 1;
  let escaped = false;
  let inCharClass = false;

  while (i < chars.length) {
    const ch = chars[i];

    if (ch === "\n" || ch === "\r") {
      return null;
    }

    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      i += 1;
      continue;
    }

    if (ch === "[" && !inCharClass) {
      inCharClass = true;
      i += 1;
      continue;
    }

    if (ch === "]" && inCharClass) {
      inCharClass = false;
      i += 1;
      continue;
    }

    if (ch === "/" && !inCharClass) {
      i += 1;
      while (i < chars.length && isAsciiLetter(chars[i])) {
        i += 1;
      }
      return i;
    }

    i += 1;
  }

  return null;
}

// regex fallback 用にコメントだけを落とし、行番号は維持する。
function stripJsCommentsPreservingLines(source) {
  const chars = source.split("");
  const result = [];
  let i = 0;
  let state = "normal";
  let escaped = false;

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

    if (state === "single-quote" || state === "double-quote" || state === "template") {
      result.push(ch);

      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && ch === "'")
        || (state === "double-quote" && ch === "\"")
        || (state === "template" && ch === "`")
      ) {
        state = "normal";
      }

      i += 1;
      continue;
    }

    if (ch === "'" || ch === "\"" || ch === "`") {
      state =
        ch === "'" ? "single-quote"
          : ch === "\"" ? "double-quote"
            : "template";
      result.push(ch);
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

    result.push(ch);
    i += 1;
  }

  return result.join("");
}

// 文字列/コメントを空白化し、コード領域だけを残す（行数とインデックスは維持）。
function maskNonCodePreservingLines(source) {
  const chars = source.split("");
  const result = [];
  let i = 0;
  let state = "normal";
  let escaped = false;
  const templateExpressionDepths = [];
  let canStartRegexLiteral = true;

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
      result.push(ch === "\n" ? "\n" : " ");

      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && ch === "'")
        || (state === "double-quote" && ch === "\"")
      ) {
        state = "normal";
        canStartRegexLiteral = false;
      }

      i += 1;
      continue;
    }

    if (state === "template") {
      if (escaped) {
        result.push(ch === "\n" ? "\n" : " ");
        escaped = false;
        i += 1;
        continue;
      }

      if (ch === "\\") {
        result.push(" ");
        escaped = true;
        i += 1;
        continue;
      }

      if (ch === "$" && next === "{") {
        result.push("$", "{");
        templateExpressionDepths.push(1);
        state = "normal";
        canStartRegexLiteral = true;
        i += 2;
        continue;
      }

      if (ch === "`") {
        result.push(" ");
        state = "normal";
        canStartRegexLiteral = false;
        i += 1;
        continue;
      }

      result.push(ch === "\n" ? "\n" : " ");
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
      if (ch === "`") {
        state = "template";
      } else {
        state = ch === "'" ? "single-quote" : "double-quote";
      }
      escaped = false;
      result.push(" ");
      i += 1;
      continue;
    }

    if (isIdentifierStartChar(ch)) {
      let end = i + 1;
      while (end < chars.length && isIdentifierPartChar(chars[end])) {
        end += 1;
      }
      const token = source.slice(i, end);
      for (let cursor = i; cursor < end; cursor += 1) {
        result.push(chars[cursor]);
      }
      canStartRegexLiteral = REGEX_LITERAL_PREFIX_KEYWORDS.has(token);
      i = end;
      continue;
    }

    if (/[0-9]/u.test(ch)) {
      let end = i + 1;
      while (end < chars.length && /[0-9A-Za-z._]/u.test(chars[end])) {
        end += 1;
      }
      for (let cursor = i; cursor < end; cursor += 1) {
        result.push(chars[cursor]);
      }
      canStartRegexLiteral = false;
      i = end;
      continue;
    }

    if (ch === "/" && next !== "/" && next !== "*" && canStartRegexLiteral) {
      const regexEnd = findRegexLiteralEnd(chars, i);
      if (regexEnd != null) {
        for (let cursor = i; cursor < regexEnd; cursor += 1) {
          const maskChar = chars[cursor];
          result.push(maskChar === "\n" ? "\n" : maskChar === "\r" ? "\r" : " ");
        }
        canStartRegexLiteral = false;
        i = regexEnd;
        continue;
      }
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
          canStartRegexLiteral = false;
        }
      }
    }

    if (ch === "}" || ch === "]" || ch === ")") {
      canStartRegexLiteral = false;
    } else if (ch === "+" || ch === "-") {
      canStartRegexLiteral = next === ch ? false : true;
    } else if (
      ch === "{"
      || ch === "["
      || ch === "("
      || ch === ";"
      || ch === ","
      || ch === ":"
      || ch === "?"
      || ch === "!"
      || ch === "~"
      || ch === "="
      || ch === "&"
      || ch === "|"
      || ch === "^"
      || ch === "%"
      || ch === "*"
      || ch === "<"
      || ch === ">"
      || ch === "/"
    ) {
      canStartRegexLiteral = true;
    }

    i += 1;
  }

  return result.join("");
}

function firstNonWhitespaceOffset(text) {
  for (let i = 0; i < text.length; i += 1) {
    if (!/\s/u.test(text[i])) return i;
  }
  return -1;
}

function startsInCodeRegion(maskedCode, matchText, matchIndex) {
  const offset = firstNonWhitespaceOffset(matchText);
  if (offset === -1) return false;

  const tokenIndex = matchIndex + offset;
  if (tokenIndex < 0 || tokenIndex >= maskedCode.length) return false;

  return maskedCode[tokenIndex] !== " ";
}

function previousNonWhitespaceChar(source, index) {
  let i = index - 1;
  while (i >= 0) {
    const ch = source[i];
    if (!/\s/u.test(ch)) return ch;
    i -= 1;
  }
  return "";
}

function previousNonWhitespaceToken(source, index) {
  let i = index - 1;
  while (i >= 0 && /\s/u.test(source[i])) {
    i -= 1;
  }
  if (i < 0) return "";

  if (isIdentifierPartChar(source[i])) {
    const end = i + 1;
    while (i >= 0 && isIdentifierPartChar(source[i])) {
      i -= 1;
    }
    return source.slice(i + 1, end);
  }

  return source[i];
}

function isStandaloneImportOrRequireCall(source, keywordStartIndex) {
  const prev = previousNonWhitespaceChar(source, keywordStartIndex);
  if (!prev) return true;
  if (prev === ".") return false;
  if (isIdentifierPartChar(prev)) {
    const token = previousNonWhitespaceToken(source, keywordStartIndex);
    if (REGEX_LITERAL_PREFIX_KEYWORDS.has(token)) return true;
    return false;
  }
  return true;
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function scriptKindFor(TS, absPath) {
  if (!TS) return undefined;

  const ext = path.extname(absPath);
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return TS.ScriptKind.TS;
  if (ext === ".tsx") return TS.ScriptKind.TSX;
  if (ext === ".jsx") return TS.ScriptKind.JSX;
  return TS.ScriptKind.JS;
}

function bindingPatternContainsIdentifier(node, identifier, TS) {
  if (!node) return false;

  if (TS.isIdentifier(node)) {
    return node.text === identifier;
  }

  if (TS.isObjectBindingPattern(node)) {
    return node.elements.some((element) => bindingPatternContainsIdentifier(element.name, identifier, TS));
  }

  if (TS.isArrayBindingPattern(node)) {
    return node.elements.some((element) => {
      if (TS.isOmittedExpression(element)) return false;
      return bindingPatternContainsIdentifier(element.name, identifier, TS);
    });
  }

  return false;
}

function declarationListContainsIdentifier(declarationList, identifier, TS) {
  return declarationList.declarations.some((declaration) => bindingPatternContainsIdentifier(declaration.name, identifier, TS));
}

function declarationListIsBlockScoped(declarationList, TS) {
  return Boolean(declarationList.flags & TS.NodeFlags.BlockScoped);
}

function importClauseContainsIdentifier(importClause, identifier, TS) {
  if (!importClause) return false;
  if (importClause.name && importClause.name.text === identifier) return true;

  const namedBindings = importClause.namedBindings;
  if (!namedBindings) return false;

  if (TS.isNamespaceImport(namedBindings)) {
    return namedBindings.name.text === identifier;
  }

  if (TS.isNamedImports(namedBindings)) {
    return namedBindings.elements.some((element) => element.name.text === identifier);
  }

  return false;
}

function statementDeclaresLexicalIdentifier(statement, identifier, TS) {
  if (TS.isVariableStatement(statement)) {
    if (!declarationListIsBlockScoped(statement.declarationList, TS)) {
      return false;
    }
    return declarationListContainsIdentifier(statement.declarationList, identifier, TS);
  }

  if (TS.isFunctionDeclaration(statement)) {
    return Boolean(statement.name && statement.name.text === identifier);
  }

  if (TS.isClassDeclaration(statement) || TS.isEnumDeclaration(statement)) {
    return Boolean(statement.name && statement.name.text === identifier);
  }

  if (TS.isImportDeclaration(statement)) {
    return importClauseContainsIdentifier(statement.importClause, identifier, TS);
  }

  if (TS.isImportEqualsDeclaration(statement)) {
    return statement.name.text === identifier;
  }

  return false;
}

function getStatementContainer(node, TS) {
  if (
    TS.isSourceFile(node)
    || TS.isBlock(node)
    || TS.isModuleBlock(node)
    || TS.isCaseClause(node)
    || TS.isDefaultClause(node)
  ) {
    return node.statements;
  }
  return null;
}

function scopeHasHoistedVarDeclaration(scopeNode, identifier, TS) {
  let found = false;

  const visit = (node) => {
    if (found) return;

    if (
      node !== scopeNode
      && (
        TS.isFunctionLike(node)
        || TS.isClassLike(node)
        || TS.isModuleDeclaration(node)
      )
    ) {
      return;
    }

    if (TS.isVariableDeclaration(node) && TS.isVariableDeclarationList(node.parent)) {
      if (
        !declarationListIsBlockScoped(node.parent, TS)
        && bindingPatternContainsIdentifier(node.name, identifier, TS)
      ) {
        found = true;
        return;
      }
    }

    TS.forEachChild(node, visit);
  };

  visit(scopeNode);
  return found;
}

function isRequireShadowedInAst(identifierNode, TS) {
  const REQUIRE = "require";
  let current = identifierNode;

  while (current) {
    if (TS.isFunctionLike(current)) {
      if (current.name && TS.isIdentifier(current.name) && current.name.text === REQUIRE) {
        return true;
      }

      for (const parameter of current.parameters) {
        if (bindingPatternContainsIdentifier(parameter.name, REQUIRE, TS)) {
          return true;
        }
      }
    }

    if (
      TS.isCatchClause(current)
      && current.variableDeclaration
      && bindingPatternContainsIdentifier(current.variableDeclaration.name, REQUIRE, TS)
    ) {
      return true;
    }

    if (TS.isForStatement(current)) {
      const initializer = current.initializer;
      if (
        initializer
        && TS.isVariableDeclarationList(initializer)
        && declarationListContainsIdentifier(initializer, REQUIRE, TS)
      ) {
        return true;
      }
    }

    if (TS.isForInStatement(current) || TS.isForOfStatement(current)) {
      const initializer = current.initializer;
      if (
        TS.isVariableDeclarationList(initializer)
        && declarationListContainsIdentifier(initializer, REQUIRE, TS)
      ) {
        return true;
      }
    }

    if ((TS.isFunctionLike(current) || TS.isSourceFile(current)) && scopeHasHoistedVarDeclaration(current, REQUIRE, TS)) {
      return true;
    }

    const statements = getStatementContainer(current, TS);
    if (statements) {
      for (const statement of statements) {
        if (statementDeclaresLexicalIdentifier(statement, REQUIRE, TS)) {
          return true;
        }
      }
    }

    current = current.parent;
  }

  return false;
}

// TypeScript AST ベースで import/export/require/dynamic import を抽出する。
function parseImportEntriesWithAst(code, absPath, TS, formatPath) {
  if (!TS) return null;

  let sourceFile;
  try {
    sourceFile = TS.createSourceFile(
      typeof formatPath === "function" ? formatPath(absPath) : absPath,
      code,
      TS.ScriptTarget.Latest,
      true,
      scriptKindFor(TS, absPath),
    );
  } catch {
    return null;
  }

  const entries = [];
  const addSpecifierEntry = (specifier, node) => {
    if (typeof specifier !== "string" || specifier.length === 0) return;
    const pos = node.getStart(sourceFile);
    const lineAndChar = sourceFile.getLineAndCharacterOfPosition(pos);
    entries.push({
      kind: "module-specifier",
      specifier,
      line: lineAndChar.line + 1,
    });
  };
  const addNonLiteralEntry = (kind, node) => {
    const pos = node.getStart(sourceFile);
    const lineAndChar = sourceFile.getLineAndCharacterOfPosition(pos);
    entries.push({
      kind,
      specifier: null,
      line: lineAndChar.line + 1,
    });
  };

  const visit = (node) => {
    if (TS.isImportDeclaration(node) || TS.isExportDeclaration(node)) {
      if (node.moduleSpecifier && TS.isStringLiteralLike(node.moduleSpecifier)) {
        addSpecifierEntry(node.moduleSpecifier.text, node.moduleSpecifier);
      }
    }

    if (TS.isImportEqualsDeclaration(node) && TS.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && TS.isStringLiteralLike(expression)) {
        addSpecifierEntry(expression.text, expression);
      } else if (expression) {
        addNonLiteralEntry("require-non-literal", expression);
      } else {
        addNonLiteralEntry("require-non-literal", node);
      }
    }

    if (
      TS.isCallExpression(node)
      && node.expression.kind === TS.SyntaxKind.ImportKeyword
    ) {
      const firstArg = node.arguments[0];
      if (firstArg && TS.isStringLiteralLike(firstArg)) {
        addSpecifierEntry(firstArg.text, firstArg);
      } else if (firstArg) {
        addNonLiteralEntry("dynamic-import-non-literal", firstArg);
      } else {
        addNonLiteralEntry("dynamic-import-non-literal", node);
      }
    }

    if (
      TS.isCallExpression(node)
      && TS.isIdentifier(node.expression)
      && node.expression.text === "require"
    ) {
      if (!isRequireShadowedInAst(node.expression, TS)) {
        const firstArg = node.arguments[0];
        if (firstArg && TS.isStringLiteralLike(firstArg)) {
          addSpecifierEntry(firstArg.text, firstArg);
        } else if (firstArg) {
          addNonLiteralEntry("require-non-literal", firstArg);
        } else {
          addNonLiteralEntry("require-non-literal", node);
        }
      }
    }

    if (
      TS.isImportTypeNode(node)
      && TS.isLiteralTypeNode(node.argument)
      && TS.isStringLiteral(node.argument.literal)
    ) {
      addSpecifierEntry(node.argument.literal.text, node.argument.literal);
    }

    TS.forEachChild(node, visit);
  };

  visit(sourceFile);
  return entries;
}

function findMatchingOpenParenBackward(source, closeParenIndex) {
  if (source[closeParenIndex] !== ")") return -1;

  let depth = 1;
  for (let i = closeParenIndex - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === ")") {
      depth += 1;
      continue;
    }
    if (ch === "(") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

const NON_CALLABLE_BLOCK_HEAD_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "with",
]);

const PARAM_BINDING_REQUIRE_PATTERN = /(^|,\s*|\[\s*|\{\s*|:\s*|\.\.\.\s*)require(?=\s*(?:,|=|$|\]|\}))/u;
const HOISTED_VAR_REQUIRE_PATTERN = /\bvar\s+require\b/u;

function previousIdentifierToken(source, index) {
  let i = index - 1;
  while (i >= 0 && /\s/u.test(source[i])) i -= 1;
  const end = i + 1;
  while (i >= 0 && isIdentifierPartChar(source[i])) i -= 1;
  const start = i + 1;
  if (start >= end) return "";
  return source.slice(start, end);
}

function paramsLikelyDeclareRequireBinding(paramsText) {
  return PARAM_BINDING_REQUIRE_PATTERN.test(paramsText);
}

function isCallableParameterListBeforeBlock(source, openParenIndex, closeParenIndex, blockOpenIndex) {
  const beforeToken = previousIdentifierToken(source, openParenIndex);
  if (NON_CALLABLE_BLOCK_HEAD_KEYWORDS.has(beforeToken)) return false;

  if (beforeToken === "catch") return true;
  if (beforeToken === "function" || beforeToken === "async") return true;

  const between = source.slice(closeParenIndex + 1, blockOpenIndex);
  if (between.includes("=>")) return true;

  return beforeToken.length > 0;
}

function functionLikeBlockKindAt(source, blockOpenIndex) {
  let cursor = blockOpenIndex - 1;
  while (cursor >= 0 && /\s/u.test(source[cursor])) {
    cursor -= 1;
  }
  if (cursor < 0) return null;

  if (source[cursor] === ">" && source[cursor - 1] === "=") {
    return "function";
  }

  if (source[cursor] !== ")") return null;

  const closeParenIndex = cursor;
  const openParenIndex = findMatchingOpenParenBackward(source, closeParenIndex);
  if (openParenIndex < 0) return null;

  const beforeToken = previousIdentifierToken(source, openParenIndex);
  if (NON_CALLABLE_BLOCK_HEAD_KEYWORDS.has(beforeToken)) return null;
  if (beforeToken === "catch") return "catch";

  const between = source.slice(closeParenIndex + 1, blockOpenIndex);
  if (between.includes("=>")) return "function";

  if (beforeToken === "function" || beforeToken === "async") return "function";
  if (beforeToken.length > 0) return "function";

  return null;
}

function findMatchingCloseBraceForward(source, openBraceIndex) {
  if (source[openBraceIndex] !== "{") return -1;

  let depth = 1;
  for (let i = openBraceIndex + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function hasEnclosingCallableRequireParam(maskedCode, keywordIndex) {
  let braceDepth = 0;

  for (let i = keywordIndex - 1; i >= 0; i -= 1) {
    const ch = maskedCode[i];

    if (ch === "}") {
      braceDepth += 1;
      continue;
    }

    if (ch !== "{") continue;

    if (braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }

    let cursor = i - 1;
    while (cursor >= 0 && /\s/u.test(maskedCode[cursor])) {
      cursor -= 1;
    }
    if (cursor < 0) continue;

    if (maskedCode[cursor] === ">" && maskedCode[cursor - 1] === "=") {
      let paramCursor = cursor - 2;
      while (paramCursor >= 0 && /\s/u.test(maskedCode[paramCursor])) {
        paramCursor -= 1;
      }

      if (paramCursor >= 0 && maskedCode[paramCursor] === ")") {
        const closeParenIndex = paramCursor;
        const openParenIndex = findMatchingOpenParenBackward(maskedCode, closeParenIndex);
        if (openParenIndex < 0) continue;

        const paramsText = maskedCode.slice(openParenIndex + 1, closeParenIndex);
        if (paramsLikelyDeclareRequireBinding(paramsText)) {
          return true;
        }
        continue;
      }

      const end = paramCursor + 1;
      while (paramCursor >= 0 && isIdentifierPartChar(maskedCode[paramCursor])) {
        paramCursor -= 1;
      }
      const token = maskedCode.slice(paramCursor + 1, end);
      if (token === "require") {
        return true;
      }
      continue;
    }

    if (maskedCode[cursor] === ")") {
      const closeParenIndex = cursor;
      const openParenIndex = findMatchingOpenParenBackward(maskedCode, closeParenIndex);
      if (openParenIndex < 0) continue;
      if (!isCallableParameterListBeforeBlock(maskedCode, openParenIndex, closeParenIndex, i)) continue;

      const paramsText = maskedCode.slice(openParenIndex + 1, closeParenIndex);
      if (paramsLikelyDeclareRequireBinding(paramsText)) {
        return true;
      }
    }
  }

  return false;
}

function hasRequireArrowParamBeforeCall(maskedCode, keywordIndex) {
  let cursor = keywordIndex - 1;
  while (cursor >= 0 && /\s/u.test(maskedCode[cursor])) {
    cursor -= 1;
  }
  if (cursor < 0 || maskedCode[cursor] !== ">") return false;
  if (cursor - 1 < 0 || maskedCode[cursor - 1] !== "=") return false;

  let i = cursor - 2;
  while (i >= 0 && /\s/u.test(maskedCode[i])) {
    i -= 1;
  }
  if (i < 0) return false;

  if (maskedCode[i] === ")") {
    const closeParenIndex = i;
    const openParenIndex = findMatchingOpenParenBackward(maskedCode, closeParenIndex);
    if (openParenIndex < 0) return false;
    const paramsText = maskedCode.slice(openParenIndex + 1, closeParenIndex);
    return paramsLikelyDeclareRequireBinding(paramsText);
  }

  const end = i + 1;
  while (i >= 0 && isIdentifierPartChar(maskedCode[i])) {
    i -= 1;
  }
  const token = maskedCode.slice(i + 1, end);
  return token === "require";
}

function hasHoistedVarRequireInEnclosingScope(maskedCode, keywordIndex) {
  function hasHoistedVarRequireInRange(startInclusive, endExclusive) {
    if (endExclusive <= startInclusive) return false;

    const chars = maskedCode.split("");
    let i = startInclusive;

    while (i < endExclusive) {
      if (chars[i] !== "{") {
        i += 1;
        continue;
      }

      if (functionLikeBlockKindAt(maskedCode, i) !== "function") {
        i += 1;
        continue;
      }

      const closeBraceIndex = findMatchingCloseBraceForward(maskedCode, i);
      if (closeBraceIndex < 0 || closeBraceIndex >= endExclusive) {
        i += 1;
        continue;
      }

      for (let cursor = i + 1; cursor < closeBraceIndex; cursor += 1) {
        if (chars[cursor] !== "\n" && chars[cursor] !== "\r") {
          chars[cursor] = " ";
        }
      }

      i = closeBraceIndex + 1;
    }

    const scopeText = chars.slice(startInclusive, endExclusive).join("");
    return HOISTED_VAR_REQUIRE_PATTERN.test(scopeText);
  }

  let braceDepth = 0;

  for (let i = keywordIndex - 1; i >= 0; i -= 1) {
    const ch = maskedCode[i];

    if (ch === "}") {
      braceDepth += 1;
      continue;
    }

    if (ch !== "{") continue;

    if (braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }

    const closeBraceIndex = findMatchingCloseBraceForward(maskedCode, i);
    if (closeBraceIndex < 0 || closeBraceIndex < keywordIndex) continue;
    if (functionLikeBlockKindAt(maskedCode, i) !== "function") continue;

    if (hasHoistedVarRequireInRange(i + 1, closeBraceIndex)) {
      return true;
    }
  }

  return hasHoistedVarRequireInRange(0, maskedCode.length);
}

// TypeScript が使えない環境向けの簡易パーサ（精度は AST より低い）。
function parseImportEntriesWithRegexFallback(code) {
  const strippedCode = stripJsCommentsPreservingLines(code);
  const codeRegionMask = maskNonCodePreservingLines(code);
  const entries = [];
  const literalPatterns = [
    {
      regex: /^\s*import\s+(?:type\s+)?(?:[^'";]+?\sfrom\s+)?['"]([^'"]+)['"]/gm,
      callKeyword: null,
    },
    {
      regex: /^\s*export\s+(?:type\s+)?[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm,
      callKeyword: null,
    },
    {
      regex: /\bimport\s*\(\s*['"]([^'"]+)['"](?:\s*,[\s\S]*?)?\s*\)/g,
      callKeyword: "import",
    },
    {
      regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      callKeyword: "require",
    },
  ];

  for (const { regex, callKeyword } of literalPatterns) {
    for (const match of strippedCode.matchAll(regex)) {
      if (!match[1]) continue;
      const matchIndex = match.index ?? 0;
      if (!startsInCodeRegion(codeRegionMask, match[0], matchIndex)) continue;
      if (callKeyword) {
        const keywordOffset = match[0].indexOf(callKeyword);
        const keywordIndex = keywordOffset >= 0 ? matchIndex + keywordOffset : matchIndex;
        if (!isStandaloneImportOrRequireCall(strippedCode, keywordIndex)) continue;
        if (
          callKeyword === "require"
          && (
            hasEnclosingCallableRequireParam(codeRegionMask, keywordIndex)
            || hasRequireArrowParamBeforeCall(codeRegionMask, keywordIndex)
            || hasHoistedVarRequireInEnclosingScope(codeRegionMask, keywordIndex)
          )
        ) continue;
      }
      entries.push({
        kind: "module-specifier",
        specifier: match[1],
        line: lineAt(strippedCode, matchIndex),
      });
    }
  }

  const nonLiteralPatterns = [
    {
      regex: /\bimport\s*\((?!\s*['"])([\s\S]*?)\)/g,
      kind: "dynamic-import-non-literal",
      callKeyword: "import",
    },
    {
      regex: /\brequire\s*\((?!\s*['"])([\s\S]*?)\)/g,
      kind: "require-non-literal",
      callKeyword: "require",
    },
  ];

  for (const { regex, kind, callKeyword } of nonLiteralPatterns) {
    for (const match of strippedCode.matchAll(regex)) {
      if (!match[1]) continue;
      const matchIndex = match.index ?? 0;
      if (!startsInCodeRegion(codeRegionMask, match[0], matchIndex)) continue;
      const keywordOffset = match[0].indexOf(callKeyword);
      const keywordIndex = keywordOffset >= 0 ? matchIndex + keywordOffset : matchIndex;
      if (!isStandaloneImportOrRequireCall(strippedCode, keywordIndex)) continue;
      if (
        callKeyword === "require"
        && (
          hasEnclosingCallableRequireParam(codeRegionMask, keywordIndex)
          || hasRequireArrowParamBeforeCall(codeRegionMask, keywordIndex)
          || hasHoistedVarRequireInEnclosingScope(codeRegionMask, keywordIndex)
        )
      ) continue;
      entries.push({
        kind,
        specifier: null,
        line: lineAt(strippedCode, matchIndex),
      });
    }
  }

  return entries;
}

// 可能なら AST、不可なら regex fallback で import 情報を取得する。
export function parseImportEntries(code, absPath, { TS, formatPath }) {
  const astEntries = parseImportEntriesWithAst(code, absPath, TS, formatPath);
  if (astEntries) return astEntries;
  return parseImportEntriesWithRegexFallback(code);
}

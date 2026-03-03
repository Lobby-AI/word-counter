import { EMPTY_ALIAS_IMPORT_ALLOWLIST } from "../config-loader.mjs";

function stripSpecifierQueryAndHash(specifier) {
  const queryIndex = specifier.indexOf("?");
  const hashIndex = specifier.indexOf("#");
  let end = specifier.length;

  if (queryIndex !== -1) end = Math.min(end, queryIndex);
  // Leading "#" is a valid bare specifier prefix (import maps / TS paths),
  // so only treat "#" as a fragment marker when it is not the first char.
  if (hashIndex > 0) end = Math.min(end, hashIndex);

  return specifier.slice(0, end);
}

function hasDotPathSegment(specifier) {
  return specifier.split("/").some((segment) => segment === "." || segment === "..");
}

function isAllowedAliasImport(specifier, allowedAliasImports = EMPTY_ALIAS_IMPORT_ALLOWLIST) {
  const normalizedSpecifier = stripSpecifierQueryAndHash(specifier);
  if (hasDotPathSegment(normalizedSpecifier)) return false;

  if (allowedAliasImports.exact.has(normalizedSpecifier)) return true;
  if (normalizedSpecifier === "@/components/ui") return true;
  return allowedAliasImports.prefixes.some((prefix) => normalizedSpecifier.startsWith(prefix));
}

function isForbiddenAliasLikeSpecifier(specifier) {
  if (typeof specifier !== "string") return false;
  if (specifier.startsWith("@/")) return true;
  if (specifier.startsWith("#")) return true;
  if (specifier.startsWith("~/")) return true;
  if (specifier.startsWith("/")) return true;
  return false;
}

export function runAliasImportForbiddenGuard(records, {
  isRelativeSpecifier,
  resolveImport,
  formatPath,
  allowedAliasImports = EMPTY_ALIAS_IMPORT_ALLOWLIST,
}) {
  const violations = [];

  for (const record of records) {
    const importerAbs = record.abs;
    const firstLineBySpecifier = new Map();
    const seenNonLiteralIds = new Set();

    for (const item of record.importEntries) {
      if (item.kind === "dynamic-import-non-literal") {
        const line = item.line ?? 1;
        const id = `alias-import-forbidden:${formatPath(importerAbs)}::dynamic-import-non-literal:${line}`;
        if (!seenNonLiteralIds.has(id)) {
          seenNonLiteralIds.add(id);
          violations.push({
            id,
            importerAbs,
            specifier: "import(<non-literal>)",
            line,
            reason: "dynamic-import-non-literal",
          });
        }
        continue;
      }

      if (item.kind === "require-non-literal") {
        const line = item.line ?? 1;
        const id = `alias-import-forbidden:${formatPath(importerAbs)}::require-non-literal:${line}`;
        if (!seenNonLiteralIds.has(id)) {
          seenNonLiteralIds.add(id);
          violations.push({
            id,
            importerAbs,
            specifier: "require(<non-literal>)",
            line,
            reason: "require-non-literal",
          });
        }
        continue;
      }

      const specifier = item.specifier;
      if (typeof specifier !== "string") continue;
      if (isRelativeSpecifier(specifier)) continue;
      if (isAllowedAliasImport(specifier, allowedAliasImports)) continue;

      const resolvedInternalTarget = resolveImport(specifier, importerAbs);
      const isInternalAlias = Boolean(resolvedInternalTarget);
      const isAliasLikeFallback = isForbiddenAliasLikeSpecifier(specifier);
      if (!isInternalAlias && !isAliasLikeFallback) continue;

      const reason = isInternalAlias ? "internal-alias" : "alias-like-specifier";

      if (!firstLineBySpecifier.has(specifier)) {
        firstLineBySpecifier.set(specifier, {
          line: item.line ?? 1,
          reason,
        });
      }
    }

    for (const [specifier, detail] of firstLineBySpecifier.entries()) {
      violations.push({
        id: `alias-import-forbidden:${formatPath(importerAbs)}::${specifier}`,
        importerAbs,
        specifier,
        line: detail.line,
        reason: detail.reason,
      });
    }
  }

  return violations.sort((a, b) => {
    if (a.importerAbs === b.importerAbs) return a.specifier.localeCompare(b.specifier);
    return a.importerAbs.localeCompare(b.importerAbs);
  });
}

import path from "path";

export function runRelativeCrossSectionGuard(records, {
  isCodeFile,
  formatPath,
  sectionKey,
  deepestCommonParent,
  firstSegmentFromBase,
  sharedDirectoryKindSet,
}) {
  const violations = [];
  const seenIds = new Set();

  for (const record of records) {
    const importerAbs = record.abs;
    for (const item of record.resolvedImports) {
      const specifier = item.specifier;
      if (!(specifier.startsWith("./") || specifier.startsWith("../"))) continue;

      const targetAbs = item.targetAbs;
      if (!targetAbs) continue;
      if (!isCodeFile(targetAbs)) continue;

      const importerSection = sectionKey(importerAbs);
      const targetSection = sectionKey(targetAbs);
      if (importerSection === targetSection) continue;

      const importerDir = path.dirname(importerAbs);
      const targetDir = path.dirname(targetAbs);
      const dcp = deepestCommonParent([importerDir, targetDir]);
      const firstSegment = firstSegmentFromBase(dcp, targetAbs);
      if (sharedDirectoryKindSet.has(firstSegment)) continue;

      const line = item.line ?? 1;
      const id = `relative-cross-section:${formatPath(importerAbs)}::${specifier}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      violations.push({
        id,
        importerAbs,
        specifier,
        line,
        targetAbs,
        importerSection,
        targetSection,
        firstSegment,
      });
    }
  }

  return violations.sort((a, b) => {
    if (a.importerAbs === b.importerAbs) return a.specifier.localeCompare(b.specifier);
    return a.importerAbs.localeCompare(b.importerAbs);
  });
}

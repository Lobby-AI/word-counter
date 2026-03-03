import path from "path";

export function runOverCommonizationGuard(records, {
  guardThresholds,
  isCodeFile,
  formatPath,
  sharedKind,
  sectionKey,
  deepestCommonParent,
  expectedSharedDirFor,
  isUnderOrEqual,
}) {
  const importersByTarget = new Map();

  for (const record of records) {
    const importerAbs = record.abs;
    for (const item of record.resolvedImports) {
      const targetAbs = item.targetAbs;
      if (!targetAbs) continue;
      if (!isCodeFile(targetAbs)) continue;

      if (!importersByTarget.has(targetAbs)) {
        importersByTarget.set(targetAbs, new Set());
      }
      importersByTarget.get(targetAbs).add(importerAbs);
    }
  }

  const violations = [];

  for (const [targetAbs, importerSet] of importersByTarget.entries()) {
    const kind = sharedKind(targetAbs);
    if (!kind) continue;

    const importers = [...importerSet];
    if (importers.length === 0) continue;

    const sections = new Set(importers.map(sectionKey));
    if (sections.size < guardThresholds.overCommonizationMinSectionsToEnforce) continue;

    const importerDirs = importers.map((abs) => path.dirname(abs));
    const dcp = deepestCommonParent(importerDirs);
    const expectedSharedDir = expectedSharedDirFor(dcp, kind);
    const actualDir = path.dirname(targetAbs);

    const reasons = [];

    if (sections.size < guardThresholds.overCommonizationMinCrossSectionRefs) {
      reasons.push(
        `cross-section refs < ${guardThresholds.overCommonizationMinCrossSectionRefs} (actual: ${sections.size})`,
      );
    }

    if (!isUnderOrEqual(expectedSharedDir, actualDir)) {
      reasons.push(`shared location too high (expected under: ${formatPath(expectedSharedDir)})`);
    }

    if (reasons.length > 0) {
      violations.push({
        id: `over-commonization:${formatPath(targetAbs)}`,
        targetAbs,
        reasons,
        sections: [...sections].sort(),
        importers: importers.sort(),
      });
    }
  }

  return violations.sort((a, b) => a.targetAbs.localeCompare(b.targetAbs));
}

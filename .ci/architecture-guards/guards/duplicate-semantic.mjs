export function runSemanticDuplicateGuard(records, {
  guardThresholds,
  normalizeForSemanticDuplicate,
  sha256String,
}) {
  const byNormalizedHash = new Map();

  for (const record of records) {
    const normalized = normalizeForSemanticDuplicate(record.content);
    if (normalized.length < guardThresholds.semanticDuplicateMinNormalizedChars) continue;

    const normalizedHash = sha256String(normalized);
    if (!byNormalizedHash.has(normalizedHash)) byNormalizedHash.set(normalizedHash, []);
    byNormalizedHash.get(normalizedHash).push(record);
  }

  const violations = [];
  for (const [normalizedHash, group] of byNormalizedHash.entries()) {
    if (group.length < guardThresholds.duplicateSemanticMinFiles) continue;

    const rawHashes = new Set(group.map((record) => record.binaryHash));
    if (rawHashes.size <= 1) continue;

    violations.push({
      id: `duplicate:semantic:${normalizedHash}`,
      normalizedHash,
      files: group.map((record) => record.abs).sort(),
      distinctRawHashes: rawHashes.size,
    });
  }

  return violations.sort((a, b) => a.normalizedHash.localeCompare(b.normalizedHash));
}

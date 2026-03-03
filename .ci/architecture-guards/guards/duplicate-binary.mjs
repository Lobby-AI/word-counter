export function runBinaryDuplicateGuard(records, { guardThresholds }) {
  const byHash = new Map();

  for (const record of records) {
    if (!byHash.has(record.binaryHash)) byHash.set(record.binaryHash, []);
    byHash.get(record.binaryHash).push(record.abs);
  }

  const violations = [];
  for (const [hash, files] of byHash.entries()) {
    if (files.length >= guardThresholds.duplicateBinaryMinFiles) {
      violations.push({
        id: `duplicate:binary:${hash}`,
        hash,
        files: files.sort(),
      });
    }
  }

  return violations.sort((a, b) => a.hash.localeCompare(b.hash));
}

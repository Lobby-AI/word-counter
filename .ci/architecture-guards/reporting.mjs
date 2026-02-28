import fs from "fs";
import path from "path";

const JSON_REPORT_MAX_IDS = 200;
const JSON_REPORT_MAX_SAMPLES_PER_GUARD = 200;

export function normalizeSeverity(severity) {
  if (severity === "warn") return "warn";
  if (severity === "pass") return "pass";
  return "must";
}

function escapeAnnotationMessage(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function escapeAnnotationProperty(value) {
  return escapeAnnotationMessage(value)
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

function annotationCommand(severity) {
  const normalized = normalizeSeverity(severity);
  if (normalized === "warn") return "warning";
  if (normalized === "pass") return "notice";
  return "error";
}

export function createEmitAnnotation({ enable }) {
  return function emitAnnotation(severity, { file, line = 1, col = 1, title } = {}, message = "") {
    if (!enable) return;

    const props = [];
    if (file) props.push(`file=${escapeAnnotationProperty(file)}`);
    if (Number.isFinite(line)) props.push(`line=${line}`);
    if (Number.isFinite(col)) props.push(`col=${col}`);
    if (title) props.push(`title=${escapeAnnotationProperty(title)}`);

    const propText = props.length > 0 ? ` ${props.join(",")}` : "";
    console.error(`::${annotationCommand(severity)}${propText}::${escapeAnnotationMessage(message)}`);
  };
}

export function createGuardPrinters({
  formatPath,
  emitAnnotation,
  getGuardThresholds,
  getSharedDirectoryKinds,
}) {
  function printBinaryDuplicateViolations(violations, severity = "must") {
    if (violations.length === 0) return;
    const guardThresholds = getGuardThresholds();

    console.error(
      `\n[architecture-guard][${severity}] Duplicate binary scripts (${guardThresholds.duplicateBinaryMinFiles}+ identical files) detected:`,
    );
    for (const v of violations) {
      console.error(`- id: ${v.id}`);
      console.error(`  hash: ${v.hash} (${v.files.length} files)`);
      for (const file of v.files) {
        console.error(`  - ${formatPath(file)}`);
      }

      const filesForAnnotation = v.files.slice(0, guardThresholds.maxAnnotationFilesPerViolation);
      for (const file of filesForAnnotation) {
        emitAnnotation(
          severity,
          {
            file: formatPath(file),
            line: 1,
            col: 1,
            title: "architecture-guard: duplicate-binary",
          },
          `${v.id} (${v.files.length} files, hash=${v.hash})`,
        );
      }
    }
  }

  function printSemanticDuplicateViolations(violations, severity = "must") {
    if (violations.length === 0) return;
    const guardThresholds = getGuardThresholds();

    console.error(
      `\n[architecture-guard][${severity}] Semantic duplicate scripts (${guardThresholds.duplicateSemanticMinFiles}+ files, anti-hash-shift mode) detected:`,
    );
    for (const v of violations) {
      console.error(`- id: ${v.id}`);
      console.error(`  normalized-hash: ${v.normalizedHash}`);
      console.error(`  files: ${v.files.length}, distinct raw hashes: ${v.distinctRawHashes}`);
      for (const file of v.files) {
        console.error(`  - ${formatPath(file)}`);
      }

      const filesForAnnotation = v.files.slice(0, guardThresholds.maxAnnotationFilesPerViolation);
      for (const file of filesForAnnotation) {
        emitAnnotation(
          severity,
          {
            file: formatPath(file),
            line: 1,
            col: 1,
            title: "architecture-guard: duplicate-semantic",
          },
          `${v.id} (${v.files.length} files, raw-hash-kinds=${v.distinctRawHashes})`,
        );
      }
    }
  }

  function printOverCommonizationViolations(violations, severity = "warn") {
    if (violations.length === 0) return;

    console.error(`\n[architecture-guard][${severity}] Over-commonization detected:`);
    for (const v of violations) {
      console.error(`- id: ${v.id}`);
      console.error(`  module: ${formatPath(v.targetAbs)}`);
      console.error(`  reasons: ${v.reasons.join("; ")}`);
      console.error(`  sections (${v.sections.length}): ${v.sections.join(", ")}`);
      for (const importer of v.importers) {
        console.error(`  importer: ${formatPath(importer)}`);
      }

      emitAnnotation(
        severity,
        {
          file: formatPath(v.targetAbs),
          line: 1,
          col: 1,
          title: "architecture-guard: over-commonization",
        },
        `${v.id} | ${v.reasons.join("; ")}`,
      );
    }
  }

  function printRelativeCrossSectionViolations(violations, severity = "must") {
    if (violations.length === 0) return;
    const sharedDirectoryKinds = getSharedDirectoryKinds();

    console.error(
      `\n[architecture-guard][${severity}] Relative cross-section violations detected (relative import/require across sections must target shared directories: ${sharedDirectoryKinds.join(", ")}):`,
    );
    for (const v of violations) {
      console.error(`- id: ${v.id}`);
      console.error(`  importer: ${formatPath(v.importerAbs)}`);
      console.error(`  specifier: ${v.specifier}`);
      console.error(`  target: ${formatPath(v.targetAbs)}`);
      console.error(`  importer-section: ${v.importerSection}`);
      console.error(`  target-section: ${v.targetSection}`);
      console.error(`  dcp-first-segment: ${v.firstSegment || "(none)"}`);

      emitAnnotation(
        severity,
        {
          file: formatPath(v.importerAbs),
          line: v.line ?? 1,
          col: 1,
          title: "architecture-guard: relative-cross-section",
        },
        `${v.id} (cross-section relative import/require must target ${sharedDirectoryKinds.join(", ")} under deepest common parent)`,
      );
    }
  }

  function printAliasImportForbiddenViolations(violations, severity = "must") {
    if (violations.length === 0) return;

    console.error(
      `\n[architecture-guard][${severity}] Alias import violations detected (internal aliases and non-literal import/require are forbidden):`,
    );
    for (const v of violations) {
      console.error(`- id: ${v.id}`);
      console.error(`  importer: ${formatPath(v.importerAbs)}`);
      console.error(`  specifier: ${v.specifier}`);

      emitAnnotation(
        severity,
        {
          file: formatPath(v.importerAbs),
          line: v.line ?? 1,
          col: 1,
          title: "architecture-guard: alias-import-forbidden",
        },
        `${v.id} (use relative import within section or shared boundary)`,
      );
    }
  }

  return {
    duplicateBinary: printBinaryDuplicateViolations,
    duplicateSemantic: printSemanticDuplicateViolations,
    overCommonization: printOverCommonizationViolations,
    relativeCrossSection: printRelativeCrossSectionViolations,
    aliasImportForbidden: printAliasImportForbiddenViolations,
  };
}

export function printSuppressedSummary(suppressedSets) {
  const totalSuppressed = suppressedSets.reduce((sum, set) => sum + set.length, 0);
  if (totalSuppressed === 0) return;

  console.log(`\n[architecture-guard] Suppressed by config.allowedFailedIds: ${totalSuppressed}`);
  for (const set of suppressedSets) {
    for (const violation of set) {
      console.log(`- ${violation.id}`);
    }
  }
}

export function parseArgs(argv) {
  const options = {
    reportJsonPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--report-json") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--report-json requires a file path argument");
      }
      options.reportJsonPath = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--report-json=")) {
      const value = arg.slice("--report-json=".length);
      if (!value) throw new Error("--report-json requires a file path value");
      options.reportJsonPath = value;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function firstPath(paths, formatPath) {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  return formatPath(paths[0]);
}

function buildViolationSample(guardKey, violation, formatPath) {
  if (!violation || typeof violation !== "object") return null;

  switch (guardKey) {
    case "duplicateBinary":
      return {
        id: violation.id,
        file: firstPath(violation.files, formatPath),
        line: 1,
        detail: `hash=${violation.hash}, files=${Array.isArray(violation.files) ? violation.files.length : 0}`,
      };
    case "duplicateSemantic":
      return {
        id: violation.id,
        file: firstPath(violation.files, formatPath),
        line: 1,
        detail: `normalized-hash=${violation.normalizedHash}, files=${Array.isArray(violation.files) ? violation.files.length : 0}, raw-hash-kinds=${violation.distinctRawHashes ?? 0}`,
      };
    case "overCommonization":
      return {
        id: violation.id,
        file: violation.targetAbs ? formatPath(violation.targetAbs) : null,
        line: 1,
        detail: Array.isArray(violation.reasons) ? violation.reasons.join("; ") : "over-commonization detected",
      };
    case "relativeCrossSection":
      return {
        id: violation.id,
        file: violation.importerAbs ? formatPath(violation.importerAbs) : null,
        line: violation.line ?? 1,
        detail: `specifier=${violation.specifier}, target-section=${violation.targetSection}, dcp-first-segment=${violation.firstSegment || "(none)"}`,
      };
    case "aliasImportForbidden":
      return {
        id: violation.id,
        file: violation.importerAbs ? formatPath(violation.importerAbs) : null,
        line: violation.line ?? 1,
        detail: `specifier=${violation.specifier}, reason=${violation.reason ?? "alias-specifier"}`,
      };
    default:
      return {
        id: violation.id,
        file: null,
        line: 1,
        detail: "violation",
      };
  }
}

export function buildReport(results, hasMustViolations, { astImportParsingEnabled, formatPath }) {
  const summary = {
    mustActiveCount: 0,
    warnActiveCount: 0,
    suppressedCount: 0,
    hasMustViolations,
  };

  const guards = results.map((result) => {
    const severity = normalizeSeverity(result.severity);
    if (severity === "must") summary.mustActiveCount += result.active.length;
    if (severity === "warn") summary.warnActiveCount += result.active.length;
    summary.suppressedCount += result.suppressed.length;

    return {
      key: result.key,
      severity,
      activeCount: result.active.length,
      suppressedCount: result.suppressed.length,
      activeIds: result.active.slice(0, JSON_REPORT_MAX_IDS).map((v) => v.id),
      suppressedIds: result.suppressed.slice(0, JSON_REPORT_MAX_IDS).map((v) => v.id),
      activeSamples: result.active
        .slice(0, JSON_REPORT_MAX_SAMPLES_PER_GUARD)
        .map((v) => buildViolationSample(result.key, v, formatPath))
        .filter((sample) => sample != null),
      truncatedActiveIds: Math.max(0, result.active.length - JSON_REPORT_MAX_IDS),
      truncatedSuppressedIds: Math.max(0, result.suppressed.length - JSON_REPORT_MAX_IDS),
      truncatedActiveSamples: Math.max(0, result.active.length - JSON_REPORT_MAX_SAMPLES_PER_GUARD),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    astImportParsingEnabled,
    summary,
    guards,
  };
}

export function buildSkippedReport(reason, { astImportParsingEnabled }) {
  return {
    generatedAt: new Date().toISOString(),
    astImportParsingEnabled,
    skipped: true,
    skipReason: reason,
    summary: {
      mustActiveCount: 0,
      warnActiveCount: 0,
      suppressedCount: 0,
      hasMustViolations: false,
    },
    guards: [],
  };
}

export function writeJsonReport(report, reportJsonPath, { root, formatPath }) {
  if (!reportJsonPath) return;

  const abs = path.resolve(root, reportJsonPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[architecture-guard] Wrote JSON report: ${formatPath(abs)}`);
}

export function printGuardResults(results) {
  for (const result of results) {
    if (result.active.length === 0) continue;
    result.print(result.active, result.severity);
  }
}

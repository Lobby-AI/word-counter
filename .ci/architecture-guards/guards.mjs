import crypto from "crypto";
import { normalizeSeverity } from "./reporting.mjs";
import { runBinaryDuplicateGuard } from "./guards/duplicate-binary.mjs";
import { runSemanticDuplicateGuard } from "./guards/duplicate-semantic.mjs";
import { runOverCommonizationGuard } from "./guards/over-commonization.mjs";
import { runRelativeCrossSectionGuard } from "./guards/relative-cross-section.mjs";
import { runAliasImportForbiddenGuard } from "./guards/alias-import-forbidden.mjs";
import { createSectionPathHelpers } from "./guards/shared-path.mjs";

export const GUARD_KEYS = Object.freeze([
  "duplicateBinary",
  "duplicateSemantic",
  "overCommonization",
  "relativeCrossSection",
  "aliasImportForbidden",
]);

export function createGuardEngine({
  runtime,
  normalizeForSemanticDuplicate,
}) {
  const formatPath = runtime.formatPath;
  const isCodeFile = runtime.isCodeFile;
  const isRelativeSpecifier = runtime.isRelativeSpecifier;
  const resolveImport = runtime.resolveImport;

  let guardThresholds = null;
  let sharedDirectoryKinds = [];
  let sharedDirectoryKindSet = new Set(sharedDirectoryKinds);

  const sectionPathHelpers = createSectionPathHelpers({
    runtime,
    getSharedDirectoryKinds: () => sharedDirectoryKinds,
  });

  function sha256String(text) {
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  function setSharedDirectoryKinds(kinds) {
    sharedDirectoryKinds = [...kinds];
    sharedDirectoryKindSet = new Set(sharedDirectoryKinds);
  }

  function setGuardThresholds(thresholds) {
    guardThresholds = { ...thresholds };
  }

  function getGuardThresholds() {
    return guardThresholds;
  }

  function getSharedDirectoryKinds() {
    return sharedDirectoryKinds;
  }

  function applyAllowedFailedIds(violations, allowedFailedIds) {
    const active = [];
    const suppressed = [];

    for (const violation of violations) {
      if (allowedFailedIds.has(violation.id)) {
        suppressed.push(violation);
      } else {
        active.push(violation);
      }
    }

    return { active, suppressed };
  }

  function collectCodeFileRecords() {
    return runtime.collectCodeFileRecords().map((record) => ({
      ...record,
      binaryHash: sha256String(record.content),
    }));
  }

  const guardRunFactories = Object.freeze({
    duplicateBinary: {
      buildRun: (records) => () => runBinaryDuplicateGuard(records, { guardThresholds }),
    },
    duplicateSemantic: {
      buildRun: (records) => () => runSemanticDuplicateGuard(records, {
        guardThresholds,
        normalizeForSemanticDuplicate,
        sha256String,
      }),
    },
    overCommonization: {
      buildRun: (records) => () => runOverCommonizationGuard(records, {
        guardThresholds,
        isCodeFile,
        formatPath,
        ...sectionPathHelpers,
      }),
    },
    relativeCrossSection: {
      buildRun: (records) => () => runRelativeCrossSectionGuard(records, {
        isCodeFile,
        formatPath,
        sharedDirectoryKindSet,
        ...sectionPathHelpers,
      }),
    },
    aliasImportForbidden: {
      buildRun: (records, config) => () => runAliasImportForbiddenGuard(records, {
        isRelativeSpecifier,
        resolveImport,
        formatPath,
        allowedAliasImports: config.allowedAliasImports,
      }),
    },
  });

  function makeGuardDefinitions(records, config, guardPrinters) {
    return GUARD_KEYS.map((key) => {
      const severity = config.guardSeverity[key];
      const run = normalizeSeverity(severity) === "pass"
        ? () => []
        : guardRunFactories[key].buildRun(records, config);

      return { key, severity, run, print: guardPrinters[key] };
    });
  }

  return {
    setSharedDirectoryKinds,
    setGuardThresholds,
    getGuardThresholds,
    getSharedDirectoryKinds,
    applyAllowedFailedIds,
    collectCodeFileRecords,
    makeGuardDefinitions,
  };
}

import fs from "fs";

export const EMPTY_ALIAS_IMPORT_ALLOWLIST = {
  exact: new Set(),
  prefixes: [],
};

function normalizeStringArray(value, pathLabel, { configPath, formatPath }) {
  if (!Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an array in ${formatPath(configPath)}`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${pathLabel}[${index}] must be a string in ${formatPath(configPath)}`);
    }
    return item;
  });
}

function normalizeStringMap(value, pathLabel, { configPath, formatPath }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an object in ${formatPath(configPath)}`);
  }

  const out = new Map();
  for (const [key, rawVal] of Object.entries(value)) {
    if (typeof rawVal !== "string") {
      throw new Error(`${pathLabel}.${key} must be a string in ${formatPath(configPath)}`);
    }
    out.set(key, rawVal);
  }

  return out;
}

function normalizeSharedDirectoryKinds(value, options) {
  const deduped = [...new Set(normalizeStringArray(value, "sharedDirectoryKinds", options))];
  if (deduped.length === 0) {
    throw new Error(`sharedDirectoryKinds must include at least one directory in ${options.formatPath(options.configPath)}`);
  }
  return deduped;
}

function parseConfiguredSeverity(value, pathLabel, { configPath, formatPath }) {
  if (value === "must" || value === "warn" || value === "pass") return value;
  throw new Error(`${pathLabel} must be "must", "warn", or "pass" in ${formatPath(configPath)}`);
}

function parseConfiguredPositiveInteger(value, pathLabel, min, { configPath, formatPath }) {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${pathLabel} must be an integer >= ${min} in ${formatPath(configPath)}`);
  }
  return value;
}

function normalizeGuardSeverity(value, guardKeys, options) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`guardSeverity must be an object in ${options.formatPath(options.configPath)}`);
  }

  const severityByKey = {};
  for (const key of guardKeys) {
    severityByKey[key] = parseConfiguredSeverity(value[key], `guardSeverity.${key}`, options);
  }

  return severityByKey;
}

function normalizeGuardThresholds(value, options) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`guardThresholds must be an object in ${options.formatPath(options.configPath)}`);
  }

  return {
    duplicateBinaryMinFiles: parseConfiguredPositiveInteger(
      value.duplicateBinaryMinFiles,
      "guardThresholds.duplicateBinaryMinFiles",
      2,
      options,
    ),
    duplicateSemanticMinFiles: parseConfiguredPositiveInteger(
      value.duplicateSemanticMinFiles,
      "guardThresholds.duplicateSemanticMinFiles",
      2,
      options,
    ),
    semanticDuplicateMinNormalizedChars: parseConfiguredPositiveInteger(
      value.semanticDuplicateMinNormalizedChars,
      "guardThresholds.semanticDuplicateMinNormalizedChars",
      1,
      options,
    ),
    overCommonizationMinCrossSectionRefs: parseConfiguredPositiveInteger(
      value.overCommonizationMinCrossSectionRefs,
      "guardThresholds.overCommonizationMinCrossSectionRefs",
      1,
      options,
    ),
    overCommonizationMinSectionsToEnforce: parseConfiguredPositiveInteger(
      value.overCommonizationMinSectionsToEnforce,
      "guardThresholds.overCommonizationMinSectionsToEnforce",
      1,
      options,
    ),
    maxAnnotationFilesPerViolation: parseConfiguredPositiveInteger(
      value.maxAnnotationFilesPerViolation,
      "guardThresholds.maxAnnotationFilesPerViolation",
      1,
      options,
    ),
  };
}

export function loadConfig({ configPath, formatPath, guardKeys }) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file is required: ${formatPath(configPath)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse config at ${formatPath(configPath)}: ${String(error)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Config must be an object: ${formatPath(configPath)}`);
  }

  const options = { configPath, formatPath };

  if (!("sharedDirectoryKinds" in parsed)) {
    throw new Error(`Config requires a "sharedDirectoryKinds" array: ${formatPath(configPath)}`);
  }
  const sharedKinds = normalizeSharedDirectoryKinds(parsed.sharedDirectoryKinds, options);

  if (!("guardSeverity" in parsed)) {
    throw new Error(`Config requires a "guardSeverity" object: ${formatPath(configPath)}`);
  }
  const guardSeverity = normalizeGuardSeverity(parsed.guardSeverity, guardKeys, options);

  if (!("allowedFailedIds" in parsed)) {
    throw new Error(`Config requires an "allowedFailedIds" array: ${formatPath(configPath)}`);
  }
  const allowedFailedIds = new Set(
    normalizeStringArray(parsed.allowedFailedIds, "allowedFailedIds", options),
  );

  if (!("guardThresholds" in parsed)) {
    throw new Error(`Config requires a "guardThresholds" object: ${formatPath(configPath)}`);
  }
  const guardThresholds = normalizeGuardThresholds(parsed.guardThresholds, options);

  const configuredAliasResolutionOverrides = "aliasResolutionOverrides" in parsed
    ? normalizeStringMap(parsed.aliasResolutionOverrides, "aliasResolutionOverrides", options)
    : new Map();

  let allowedAliasImports = EMPTY_ALIAS_IMPORT_ALLOWLIST;
  if ("allowedAliasImports" in parsed && parsed.allowedAliasImports != null) {
    const value = parsed.allowedAliasImports;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `allowedAliasImports must be an object in ${formatPath(configPath)}`,
      );
    }

    const exact = "exact" in value
      ? new Set(normalizeStringArray(value.exact, "allowedAliasImports.exact", options))
      : new Set();

    const prefixes = "prefixes" in value
      ? normalizeStringArray(value.prefixes, "allowedAliasImports.prefixes", options)
      : [];

    allowedAliasImports = { exact, prefixes };
  }

  return {
    sharedDirectoryKinds: sharedKinds,
    guardSeverity,
    guardThresholds,
    allowedFailedIds,
    aliasResolutionOverrides: configuredAliasResolutionOverrides,
    allowedAliasImports,
  };
}

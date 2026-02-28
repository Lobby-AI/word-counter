#!/usr/bin/env node

import path from "path";
import { fileURLToPath } from "url";
import { normalizeForSemanticDuplicate as normalizeSemanticDuplicate } from "./architecture-guards/semantic-normalizer.mjs";
import { createProjectRuntime } from "./architecture-guards/project-runtime.mjs";
import { loadConfig } from "./architecture-guards/config-loader.mjs";
import { createGuardEngine, GUARD_KEYS } from "./architecture-guards/guards.mjs";
import {
  normalizeSeverity,
  createEmitAnnotation,
  createGuardPrinters,
  parseArgs,
  buildReport,
  buildSkippedReport,
  writeJsonReport,
  printGuardResults,
  printSuppressedSummary,
} from "./architecture-guards/reporting.mjs";

const ROOT = process.cwd();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(SCRIPT_DIR, "architecture-guards.config.json");
const ENABLE_GITHUB_ANNOTATIONS = process.env.GITHUB_ACTIONS === "true";

const runtime = createProjectRuntime({ root: ROOT });
const formatPath = runtime.formatPath;

const guardEngine = createGuardEngine({
  runtime,
  normalizeForSemanticDuplicate: (source) => normalizeSemanticDuplicate(source, { TS: runtime.getTypeScript() }),
});

const emitAnnotation = createEmitAnnotation({ enable: ENABLE_GITHUB_ANNOTATIONS });
const guardPrinters = createGuardPrinters({
  formatPath,
  emitAnnotation,
  getGuardThresholds: guardEngine.getGuardThresholds,
  getSharedDirectoryKinds: guardEngine.getSharedDirectoryKinds,
});

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectState = runtime.detectNextJsProject();

  if (!projectState.isNextJs) {
    const report = buildSkippedReport(projectState.reason, {
      astImportParsingEnabled: runtime.hasTypeScript(),
    });
    writeJsonReport(report, options.reportJsonPath, { root: ROOT, formatPath });
    console.log(`[architecture-guard] SKIP: ${projectState.reason}`);
    return;
  }

  runtime.setTargetProjectPaths(projectState.project);
  const targetPaths = runtime.getTargetPaths();
  console.log(
    `[architecture-guard] Target project: package=${formatPath(targetPaths.targetPackageJsonPath)}, source=${formatPath(targetPaths.sourceRoot)}, app=${formatPath(targetPaths.appRoot)}`,
  );

  const config = loadConfig({
    configPath: CONFIG_PATH,
    formatPath,
    guardKeys: GUARD_KEYS,
  });

  guardEngine.setSharedDirectoryKinds(config.sharedDirectoryKinds);
  runtime.setAliasResolutionOverrides(config.aliasResolutionOverrides);
  guardEngine.setGuardThresholds(config.guardThresholds);

  const records = guardEngine.collectCodeFileRecords();
  const guardDefinitions = guardEngine.makeGuardDefinitions(records, config, guardPrinters);

  const results = guardDefinitions.map((definition) => {
    const applied = guardEngine.applyAllowedFailedIds(definition.run(), config.allowedFailedIds);
    return {
      key: definition.key,
      severity: definition.severity,
      print: definition.print,
      active: applied.active,
      suppressed: applied.suppressed,
    };
  });

  const hasAnyActiveViolations = results.some((result) => result.active.length > 0);
  const hasMustViolations = results.some(
    (result) => normalizeSeverity(result.severity) === "must" && result.active.length > 0,
  );

  const report = buildReport(results, hasMustViolations, {
    astImportParsingEnabled: runtime.hasTypeScript(),
    formatPath,
  });
  writeJsonReport(report, options.reportJsonPath, { root: ROOT, formatPath });

  if (!hasAnyActiveViolations) {
    console.log("[architecture-guard] OK");
    if (!runtime.hasTypeScript()) {
      console.log("[architecture-guard] import parsing mode: regex fallback (typescript module was not found)");
    }
    printSuppressedSummary(results.map((result) => result.suppressed));
    return;
  }

  if (!runtime.hasTypeScript()) {
    console.error("[architecture-guard] import parsing mode: regex fallback (typescript module was not found)");
  } else {
    console.error("[architecture-guard] import parsing mode: AST (typescript)");
  }

  printGuardResults(results);
  printSuppressedSummary(results.map((result) => result.suppressed));

  console.error(
    `\n[architecture-guard] If intentional, add violation id(s) to "allowedFailedIds" in ${formatPath(CONFIG_PATH)}`,
  );
  if (hasMustViolations) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  const msg = `architecture-guard fatal error: ${error instanceof Error ? error.message : String(error)}`;
  console.error(msg);
  emitAnnotation("must", { title: "architecture-guard: fatal" }, msg);
  process.exit(1);
}

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { parseImportEntries as parseImportEntriesWithFallback } from "./import-entries.mjs";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const IGNORE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
]);

export const NO_NEXTJS_REASON = "No App Router project found (requires package.json with app/src/app directory)";

export function createProjectRuntime({ root }) {
  const ROOT = root;
  const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  let SOURCE_ROOT = null;
  let APP_ROOT = null;
  let TARGET_PACKAGE_DIR = null;
  let TARGET_PACKAGE_JSON_PATH = null;
  let aliasResolutionOverrides = new Map();
  let aliasResolutionOverridePrefixes = [];

  function loadTypeScriptFromPackageJson(packageJsonPath) {
    if (!fs.existsSync(packageJsonPath)) return null;
    const requireFromPkg = createRequire(packageJsonPath);
    return requireFromPkg("typescript");
  }

  function pickSourceAndAppRoots(packageDir) {
    const appDir = path.join(packageDir, "app");
    if (fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()) {
      return {
        sourceRoot: packageDir,
        appRoot: appDir,
      };
    }

    const srcAppDir = path.join(packageDir, "src", "app");
    if (fs.existsSync(srcAppDir) && fs.statSync(srcAppDir).isDirectory()) {
      return {
        sourceRoot: path.join(packageDir, "src"),
        appRoot: srcAppDir,
      };
    }

    return null;
  }

  function toPosix(p) {
    return p.split(path.sep).join("/");
  }

  function formatPath(absPath) {
    return toPosix(path.relative(ROOT, absPath));
  }

  function isCodeFile(filePath) {
    const baseName = path.basename(filePath);
    if (baseName.endsWith(".d.ts") || baseName.endsWith(".d.mts") || baseName.endsWith(".d.cts")) {
      return false;
    }
    return CODE_EXTENSIONS.has(path.extname(filePath));
  }

  function isInsideNodeModules(absPath) {
    return path.resolve(absPath).split(path.sep).includes("node_modules");
  }

  function walkFiles(startDir) {
    const out = [];

    function walk(dir) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const abs = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (IGNORE_DIR_NAMES.has(entry.name)) continue;
          walk(abs);
          continue;
        }

        if (entry.isFile()) {
          out.push(abs);
        }
      }
    }

    walk(startDir);
    return out;
  }

  function findNextJsAppRouterProject() {
    const packageJsonFiles = walkFiles(ROOT).filter(
      (abs) => path.basename(abs) === "package.json",
    );

    const candidates = [];
    for (const packageJsonPath of packageJsonFiles) {
      if (!fs.existsSync(packageJsonPath)) continue;
      const packageDir = path.dirname(packageJsonPath);
      const roots = pickSourceAndAppRoots(packageDir);
      if (!roots) continue;

      candidates.push({
        packageJsonPath,
        packageDir,
        sourceRoot: roots.sourceRoot,
        appRoot: roots.appRoot,
      });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aIsRoot = a.packageDir === ROOT ? 0 : 1;
      const bIsRoot = b.packageDir === ROOT ? 0 : 1;
      if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;

      const aIsWeb = path.basename(a.packageDir) === "web" ? 0 : 1;
      const bIsWeb = path.basename(b.packageDir) === "web" ? 0 : 1;
      if (aIsWeb !== bIsWeb) return aIsWeb - bIsWeb;

      const aDepth = toPosix(path.relative(ROOT, a.packageDir)).split("/").length;
      const bDepth = toPosix(path.relative(ROOT, b.packageDir)).split("/").length;
      if (aDepth !== bDepth) return aDepth - bDepth;

      return a.packageDir.localeCompare(b.packageDir);
    });

    return candidates[0];
  }

  function detectNextJsProject() {
    const project = findNextJsAppRouterProject();
    if (!project) {
      return {
        isNextJs: false,
        reason: NO_NEXTJS_REASON,
        project: null,
      };
    }

    return {
      isNextJs: true,
      reason: "",
      project,
    };
  }

  function loadTypeScriptModule() {
    const packageJsonCandidates = [
      path.join(SCRIPT_REPO_ROOT, "package.json"),
      path.join(SCRIPT_REPO_ROOT, "web", "package.json"),
      path.join(ROOT, "package.json"),
      path.join(ROOT, "web", "package.json"),
    ];

    for (const packageJsonPath of packageJsonCandidates) {
      try {
        const mod = loadTypeScriptFromPackageJson(packageJsonPath);
        if (mod) return mod;
      } catch {
        // Ignore and continue fallback lookup.
      }
    }

    return null;
  }

  function createTypeScriptModuleResolutionHost(TS) {
    return {
      fileExists: (p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      },
      readFile: (p) => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          return undefined;
        }
      },
      directoryExists: (p) => {
        try {
          return fs.existsSync(p) && fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      },
      getDirectories: (p) => {
        try {
          return fs.readdirSync(p, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        } catch {
          return [];
        }
      },
      realpath: (p) => {
        try {
          return fs.realpathSync(p);
        } catch {
          return p;
        }
      },
    };
  }

  let TS = loadTypeScriptModule();
  let TS_MODULE_RESOLUTION_HOST = TS ? createTypeScriptModuleResolutionHost(TS) : null;
  let TS_COMPILER_OPTIONS = null;

  function readTypeScriptConfig(configPath) {
    if (!TS || !TS_MODULE_RESOLUTION_HOST) return null;
    if (!fs.existsSync(configPath)) return null;

    try {
      const raw = TS.readConfigFile(configPath, TS_MODULE_RESOLUTION_HOST.readFile);
      if (raw?.error) return null;

      const parseHost = {
        useCaseSensitiveFileNames: TS.sys?.useCaseSensitiveFileNames ?? true,
        fileExists: TS_MODULE_RESOLUTION_HOST.fileExists,
        readFile: TS_MODULE_RESOLUTION_HOST.readFile,
        readDirectory: TS.sys?.readDirectory
          ? TS.sys.readDirectory.bind(TS.sys)
          : () => [],
      };

      const parsed = TS.parseJsonConfigFileContent(
        raw.config,
        parseHost,
        path.dirname(configPath),
        {},
        configPath,
      );
      return parsed?.options ?? null;
    } catch {
      return null;
    }
  }

  function loadTypeScriptCompilerOptions() {
    if (!TS || !TARGET_PACKAGE_DIR) return null;

    const candidates = [
      path.join(TARGET_PACKAGE_DIR, "tsconfig.json"),
      path.join(TARGET_PACKAGE_DIR, "jsconfig.json"),
    ];
    for (const configPath of candidates) {
      const options = readTypeScriptConfig(configPath);
      if (options) return options;
    }

    return null;
  }

  function setTargetProjectPaths(project) {
    TARGET_PACKAGE_DIR = project.packageDir;
    TARGET_PACKAGE_JSON_PATH = project.packageJsonPath;
    SOURCE_ROOT = project.sourceRoot;
    APP_ROOT = project.appRoot;

    if (!TS && TARGET_PACKAGE_JSON_PATH) {
      try {
        TS = loadTypeScriptFromPackageJson(TARGET_PACKAGE_JSON_PATH);
        TS_MODULE_RESOLUTION_HOST = TS ? createTypeScriptModuleResolutionHost(TS) : null;
      } catch {
        // If TypeScript cannot be loaded, guards still run with regex fallback.
      }
    }

    TS_COMPILER_OPTIONS = loadTypeScriptCompilerOptions();
  }

  function setAliasResolutionOverrides(overrides) {
    aliasResolutionOverrides = new Map(overrides);
    aliasResolutionOverridePrefixes = [...aliasResolutionOverrides.entries()]
      .filter(([specifier]) => specifier.endsWith("/"))
      .sort((a, b) => b[0].length - a[0].length);
  }

  function isInsideSourceRoot(absPath) {
    if (!SOURCE_ROOT) return false;
    if (isInsideNodeModules(absPath)) return false;
    const rel = path.relative(SOURCE_ROOT, absPath);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  function resolveImportWithTypeScript(specifier, importerAbs) {
    if (!TS || !TS_COMPILER_OPTIONS || !TS_MODULE_RESOLUTION_HOST) return null;
    if (typeof TS.resolveModuleName !== "function") return null;

    try {
      const resolved = TS.resolveModuleName(
        specifier,
        importerAbs,
        TS_COMPILER_OPTIONS,
        TS_MODULE_RESOLUTION_HOST,
      );
      const resolvedFileName = resolved?.resolvedModule?.resolvedFileName;
      if (typeof resolvedFileName !== "string") return null;

      const abs = path.resolve(resolvedFileName);
      if (!isCodeFile(abs)) return null;
      if (!isInsideSourceRoot(abs)) return null;
      return abs;
    } catch {
      return null;
    }
  }

  function resolveModuleCandidate(base) {
    const candidates = [];
    const ext = path.extname(base);

    function pushExplicitExtensionFallbacks() {
      const dirname = path.dirname(base);
      const stem = path.basename(base, ext);

      if (ext === ".js") {
        candidates.push(
          path.join(dirname, `${stem}.ts`),
          path.join(dirname, `${stem}.tsx`),
          path.join(dirname, `${stem}.mts`),
        );
        return;
      }

      if (ext === ".jsx") {
        candidates.push(path.join(dirname, `${stem}.tsx`));
        return;
      }

      if (ext === ".mjs") {
        candidates.push(path.join(dirname, `${stem}.mts`));
      }
    }

    if (ext) {
      candidates.push(base);
      pushExplicitExtensionFallbacks();
    } else {
      for (const ext of CODE_EXTENSIONS) {
        candidates.push(base + ext);
      }
      for (const ext of CODE_EXTENSIONS) {
        candidates.push(path.join(base, "index" + ext));
      }
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    }

    return null;
  }

  function isRelativeSpecifier(specifier) {
    return specifier.startsWith("./") || specifier.startsWith("../");
  }

  function resolveImport(specifier, importerAbs) {
    if (typeof specifier !== "string" || specifier.length === 0) return null;
    let base = null;

    if (isRelativeSpecifier(specifier)) {
      base = path.resolve(path.dirname(importerAbs), specifier);
    } else if (aliasResolutionOverrides.has(specifier)) {
      if (!SOURCE_ROOT) return null;
      base = path.resolve(SOURCE_ROOT, aliasResolutionOverrides.get(specifier));
    } else if (SOURCE_ROOT) {
      const prefixOverride = aliasResolutionOverridePrefixes.find(([prefix]) => specifier.startsWith(prefix));
      if (prefixOverride) {
        const [prefix, targetPath] = prefixOverride;
        const suffix = specifier.slice(prefix.length).replace(/^[/\\]+/, "");
        base = suffix.length > 0
          ? path.resolve(SOURCE_ROOT, targetPath, suffix)
          : path.resolve(SOURCE_ROOT, targetPath);
      }
    }

    if (!base && specifier.startsWith("@/")) {
      if (!SOURCE_ROOT) return null;
      base = path.resolve(SOURCE_ROOT, specifier.slice(2));
    }

    if (base) {
      const resolved = resolveModuleCandidate(base);
      if (resolved && isInsideSourceRoot(resolved)) {
        return resolved;
      }
    }

    if (!isRelativeSpecifier(specifier)) {
      const tsResolved = resolveImportWithTypeScript(specifier, importerAbs);
      if (tsResolved) return tsResolved;
    }

    return null;
  }

  function collectCodeFileRecords() {
    if (!SOURCE_ROOT || !fs.existsSync(SOURCE_ROOT)) return [];

    const files = walkFiles(SOURCE_ROOT).filter(isCodeFile);
    return files.map((abs) => {
      const content = fs.readFileSync(abs, "utf8");
      const importEntries = parseImportEntriesWithFallback(content, abs, { TS, formatPath });
      const resolvedImports = importEntries
        .filter((entry) => typeof entry.specifier === "string")
        .map((entry) => ({
          specifier: entry.specifier,
          line: entry.line,
          targetAbs: resolveImport(entry.specifier, abs),
        }));
      return {
        abs,
        content,
        importEntries,
        resolvedImports,
      };
    });
  }

  function getTargetPaths() {
    return {
      targetPackageJsonPath: TARGET_PACKAGE_JSON_PATH,
      sourceRoot: SOURCE_ROOT,
      appRoot: APP_ROOT,
    };
  }

  function getSourceRoot() {
    return SOURCE_ROOT;
  }

  function hasTypeScript() {
    return Boolean(TS);
  }

  function getTypeScript() {
    return TS;
  }

  return {
    toPosix,
    formatPath,
    isCodeFile,
    isRelativeSpecifier,
    detectNextJsProject,
    setTargetProjectPaths,
    setAliasResolutionOverrides,
    resolveImport,
    collectCodeFileRecords,
    getTargetPaths,
    getSourceRoot,
    hasTypeScript,
    getTypeScript,
  };
}

import path from "path";

export function createSectionPathHelpers({ runtime, getSharedDirectoryKinds }) {
  function sectionKey(importerAbs) {
    const sourceRoot = runtime.getSourceRoot();
    if (!sourceRoot) return "__root__";

    const rel = runtime.toPosix(path.relative(sourceRoot, importerAbs));
    const parts = rel.split("/");
    const appIdx = parts.indexOf("app");

    if (appIdx === -1) return parts[0] || "__root__";

    const first = parts[appIdx + 1];
    if (!first) return "app/__root__";

    if (first.startsWith("(") && first.endsWith(")")) {
      const second = parts[appIdx + 2] || "__root__";
      if (second.includes(".")) return `app/${first}/__root__`;
      return `app/${first}/${second}`;
    }

    if (first.includes(".")) return "app/__root__";
    return `app/${first}`;
  }

  function deepestCommonParent(absDirs) {
    if (absDirs.length === 0) return null;
    if (absDirs.length === 1) return absDirs[0];

    const splitPaths = absDirs.map((dir) => path.resolve(dir).split(path.sep));
    const minLen = Math.min(...splitPaths.map((parts) => parts.length));

    let commonLen = 0;
    for (let i = 0; i < minLen; i += 1) {
      const token = splitPaths[0][i];
      if (splitPaths.every((parts) => parts[i] === token)) {
        commonLen += 1;
      } else {
        break;
      }
    }

    if (commonLen === 0) return path.parse(absDirs[0]).root;
    return splitPaths[0].slice(0, commonLen).join(path.sep) || path.parse(absDirs[0]).root;
  }

  function sharedKind(absModule) {
    const sourceRoot = runtime.getSourceRoot();
    if (!sourceRoot) return null;

    const rel = runtime.toPosix(path.relative(sourceRoot, absModule));
    const parts = rel.split("/");
    const appIdx = parts.indexOf("app");
    if (appIdx === -1) return null;

    for (const kind of getSharedDirectoryKinds()) {
      const idx = parts.indexOf(kind);
      if (idx === -1) continue;

      const depthFromApp = idx - appIdx;
      if (depthFromApp >= 1) {
        return kind;
      }
    }

    return null;
  }

  function isUnderOrEqual(parentDir, childDir) {
    const rel = path.relative(parentDir, childDir);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  function expectedSharedDirFor(importerCommonDir, kind) {
    if (path.basename(importerCommonDir) === kind) {
      return importerCommonDir;
    }
    return path.join(importerCommonDir, kind);
  }

  function firstSegmentFromBase(baseDir, targetAbs) {
    const rel = runtime.toPosix(path.relative(baseDir, targetAbs));
    if (!rel || rel === ".") return "";
    return rel.split("/")[0] || "";
  }

  return {
    sectionKey,
    deepestCommonParent,
    sharedKind,
    isUnderOrEqual,
    expectedSharedDirFor,
    firstSegmentFromBase,
  };
}

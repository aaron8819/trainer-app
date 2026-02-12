#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const NEXT_DIR = path.join(PROJECT_ROOT, ".next");
const SERVER_APP_DIR = path.join(NEXT_DIR, "server", "app");
const BUILD_MANIFEST_PATH = path.join(NEXT_DIR, "build-manifest.json");

const args = process.argv.slice(2);
const outputJson = getArgValue("--json");
const outputMarkdown = getArgValue("--markdown");

const buildManifest = readJson(BUILD_MANIFEST_PATH);
const sharedFiles = uniqueJsFiles([
  ...(buildManifest.polyfillFiles ?? []),
  ...(buildManifest.rootMainFiles ?? []),
]);

const sharedBytes = sumFileBytes(sharedFiles);
const routeManifests = findRouteManifestFiles(SERVER_APP_DIR);
const routes = routeManifests
  .map((manifestPath) => buildRouteMetric(manifestPath, sharedFiles))
  .filter((metric) => metric !== null)
  .sort((a, b) => a.route.localeCompare(b.route));

const result = {
  generatedAt: new Date().toISOString(),
  shared: {
    files: sharedFiles,
    bytes: sharedBytes,
    kb: toKb(sharedBytes),
  },
  routes,
};

if (outputJson) {
  writeTextFile(outputJson, `${JSON.stringify(result, null, 2)}\n`);
}

if (outputMarkdown) {
  writeTextFile(outputMarkdown, toMarkdown(result));
}

if (!outputJson && !outputMarkdown) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const nextValue = args[index + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return nextValue;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniqueJsFiles(files) {
  return [...new Set(files.filter((file) => file.endsWith(".js")))];
}

function findRouteManifestFiles(dir) {
  const files = [];
  walk(dir, (filePath) => {
    if (filePath.endsWith("page_client-reference-manifest.js")) {
      files.push(filePath);
    }
  });
  return files;
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, onFile);
      continue;
    }
    if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}

function buildRouteMetric(manifestPath, sharedJsFiles) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = parseManifestAssignment(raw);
  if (!parsed) {
    return null;
  }

  const { routeKey, routeBody } = parsed;
  const clientModules = routeBody?.clientModules ?? {};
  const routeFiles = [];

  for (const moduleInfo of Object.values(clientModules)) {
    const chunks = Array.isArray(moduleInfo?.chunks) ? moduleInfo.chunks : [];
    for (const chunk of chunks) {
      if (typeof chunk !== "string") {
        continue;
      }
      if (!chunk.endsWith(".js")) {
        continue;
      }
      if (!chunk.startsWith("static/")) {
        continue;
      }
      routeFiles.push(chunk);
    }
  }

  const uniqueRouteFiles = [...new Set(routeFiles)].filter(
    (chunkFile) => !sharedJsFiles.includes(chunkFile)
  );
  const routeOnlyBytes = sumFileBytes(uniqueRouteFiles);
  const totalBytes = sharedBytes + routeOnlyBytes;

  return {
    route: normalizeRoute(routeKey),
    totalBytes,
    totalKb: toKb(totalBytes),
    routeOnlyBytes,
    routeOnlyKb: toKb(routeOnlyBytes),
    routeFiles: uniqueRouteFiles.sort(),
  };
}

function parseManifestAssignment(sourceText) {
  const assignmentMatch = sourceText.match(
    /__RSC_MANIFEST\["(?<route>[^"]+)"\]\s*=\s*(?<json>\{[\s\S]*\})\s*;?\s*$/m
  );
  if (!assignmentMatch?.groups?.route || !assignmentMatch.groups.json) {
    return null;
  }

  return {
    routeKey: assignmentMatch.groups.route,
    routeBody: JSON.parse(assignmentMatch.groups.json),
  };
}

function normalizeRoute(routeKey) {
  let route = routeKey;
  if (route.endsWith("/page")) {
    route = route.slice(0, -"/page".length);
  }
  return route || "/";
}

function sumFileBytes(files) {
  return files.reduce((sum, file) => sum + fileBytes(file), 0);
}

function fileBytes(relativeBuildPath) {
  const absolutePath = path.join(NEXT_DIR, relativeBuildPath);
  try {
    const stats = fs.statSync(absolutePath);
    return stats.size;
  } catch {
    return 0;
  }
}

function toKb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

function writeTextFile(target, text) {
  const absolutePath = path.resolve(PROJECT_ROOT, target);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, text, "utf8");
}

function toMarkdown(data) {
  const lines = [];
  lines.push("# Route JS Bundle Report");
  lines.push("");
  lines.push(`- Generated at: ${data.generatedAt}`);
  lines.push(`- Shared JS: ${data.shared.kb} KB (${data.shared.bytes} bytes)`);
  lines.push("");
  lines.push("| Route | Total KB | Route-only KB |");
  lines.push("| --- | ---: | ---: |");
  for (const route of data.routes) {
    lines.push(`| \`${route.route}\` | ${route.totalKb} | ${route.routeOnlyKb} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

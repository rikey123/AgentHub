import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const skippedDirs = new Set([".git", "node_modules", "dist", "build", "coverage", ".turbo", ".next", "tmp"]);

export async function readText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

export async function walkFiles(startRelativePath, options = {}) {
  const start = path.join(repoRoot, startRelativePath);
  const extensions = options.extensions ? new Set(options.extensions) : null;
  const files = [];

  async function visit(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skippedDirs.has(entry.name)) {
          await visit(path.join(dir, entry.name));
        }
        continue;
      }

      if (!entry.isFile()) continue;
      const absolutePath = path.join(dir, entry.name);
      if (extensions && !extensions.has(path.extname(entry.name))) continue;
      files.push(path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/"));
    }
  }

  await visit(start);
  return files.sort();
}

export async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

export function extractEventRegistry(source) {
  const entries = [];
  const entryPattern = /\{\s*type:\s*"([^"]+)",\s*category:\s*"([^"]+)",\s*durability:\s*"(durable|ephemeral)",\s*visibility:\s*"(main|detail|both)",\s*schemaVersion:\s*(\d+)\s*\}/g;
  for (const match of source.matchAll(entryPattern)) {
    entries.push({
      type: match[1],
      category: match[2],
      durability: match[3],
      visibility: match[4],
      schemaVersion: Number(match[5])
    });
  }
  return entries;
}

export async function loadEventRegistry() {
  return extractEventRegistry(await readText("packages/protocol/src/events/registry.ts"));
}

export function failCheck(name, errors) {
  process.stderr.write(`${name} failed\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
  process.exitCode = 1;
}

export function passCheck(name, detail) {
  process.stdout.write(`${name} passed${detail ? ` (${detail})` : ""}\n`);
}

export async function runCheck(name, check) {
  const errors = await check();
  if (errors.length > 0) {
    failCheck(name, errors);
  } else {
    passCheck(name, check.detail);
  }
}

export function unique(values) {
  return [...new Set(values)];
}

export function lineNumberFor(source, index) {
  return source.slice(0, index).split("\n").length;
}

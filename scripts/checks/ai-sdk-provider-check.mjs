import { lineNumberFor, readText, runCheck, walkFiles } from "./lib.mjs";

const aiSdkCallPattern = /\b(streamText|generateText|streamObject)\s*\(/g;
const modelStringPattern = /\bmodel\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`$\\]*(?:\\.[^`$\\]*)*)`)/g;

function normalizeTarget(target) {
  return target.replaceAll("\\", "/");
}

function isSupportedFile(file) {
  return /\.(?:[cm]?[jt]sx?)$/i.test(file);
}

async function collectFiles(targets) {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

  if (targets.length === 0) {
    return walkFiles("packages", { extensions });
  }

  const files = [];
  for (const target of targets) {
    const normalized = normalizeTarget(target);

    if (normalized.endsWith("/")) {
      files.push(...(await walkFiles(normalized.slice(0, -1), { extensions })));
      continue;
    }

    if (isSupportedFile(normalized)) {
      files.push(normalized);
      continue;
    }

    files.push(...(await walkFiles(normalized, { extensions })));
  }

  return [...new Set(files)].sort();
}

function findViolations(source, file) {
  const violations = [];

  for (const callMatch of source.matchAll(aiSdkCallPattern)) {
    const callStart = callMatch.index ?? 0;
    const slice = source.slice(callStart, Math.min(source.length, callStart + 4000));
    const modelMatch = modelStringPattern.exec(slice);
    modelStringPattern.lastIndex = 0;

    if (!modelMatch) continue;

    const modelIndex = callStart + (modelMatch.index ?? 0);
    const line = lineNumberFor(source, modelIndex);
    violations.push(`${file}:${line} plain string model ID passed to ${callMatch[1]}(); use an explicit provider model instead`);
  }

  return violations;
}

const targets = process.argv.slice(2);

await runCheck("ai-sdk-provider:check", async function checkAiSdkProvider() {
  const files = await collectFiles(targets);
  const errors = [];

  for (const file of files) {
    const source = await readText(file);
    errors.push(...findViolations(source, file));
  }

  checkAiSdkProvider.detail = `${files.length} files scanned`;
  return errors;
});

#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [packageSpec, binName, ...binArgs] = process.argv.slice(2);

if (!packageSpec || !binName) {
  console.error("usage: npm-acp-runner.mjs <package-spec> <bin-name> [args...]");
  process.exit(64);
}

const npmCacheDir = process.env.NPM_CONFIG_CACHE || join(homedir(), ".agenthub", "npm-cache");
const installRoot = join(homedir(), ".agenthub", "npm-runtimes", safeName(packageSpec));
const packageRoot = packageRootForSpec(packageSpec, installRoot);
const binPath = join(installRoot, "node_modules", ".bin", process.platform === "win32" ? `${binName}.cmd` : binName);

if (!existsSync(join(packageRoot, "package.json"))) {
  const installArgs = [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    installRoot,
    packageSpec
  ];
  const npmCommand = process.platform === "win32" ? "cmd.exe" : "npm";
  const npmArgs = process.platform === "win32" ? ["/c", "npm", ...installArgs] : installArgs;
  const result = spawnSync(npmCommand, npmArgs, {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NPM_CONFIG_CACHE: npmCacheDir },
    windowsHide: true
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

patchInstalledRuntime(packageSpec, installRoot);

const packageBinPath = packageBinEntrypoint(packageRoot, binName);
const hasBinShim = existsSync(binPath);
if (!hasBinShim && packageBinPath === undefined) {
  console.error(`unable to locate ${binName} in ${packageSpec}`);
  process.exit(1);
}

const command = process.platform === "win32"
  ? hasBinShim ? "cmd.exe" : process.execPath
  : hasBinShim ? binPath : process.execPath;
const args = process.platform === "win32"
  ? hasBinShim ? ["/c", binPath, ...binArgs] : [packageBinPath, ...binArgs]
  : hasBinShim ? binArgs : [packageBinPath, ...binArgs];
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: { ...process.env, NPM_CONFIG_CACHE: npmCacheDir },
  stdio: "inherit",
  windowsHide: true
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

function safeName(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/gu, "_");
}

function packageRootForSpec(spec, root) {
  return join(root, "node_modules", ...packageNameFromSpec(spec).split("/"));
}

function packageNameFromSpec(spec) {
  if (spec.startsWith("@")) {
    const versionAt = spec.indexOf("@", 1);
    return versionAt === -1 ? spec : spec.slice(0, versionAt);
  }
  const versionAt = spec.indexOf("@");
  return versionAt === -1 ? spec : spec.slice(0, versionAt);
}

function packageBinEntrypoint(root, requestedBinName) {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const bin = packageJson.bin;
    if (typeof bin === "string") return join(root, bin);
    if (bin !== null && typeof bin === "object" && typeof bin[requestedBinName] === "string") return join(root, bin[requestedBinName]);
  } catch {
    return undefined;
  }
  return undefined;
}

function patchInstalledRuntime(spec, root) {
  if (!spec.startsWith("@agentclientprotocol/claude-agent-acp@")) return;
  const target = join(root, "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "acp-agent.js");
  if (!existsSync(target)) return;
  const source = readFileSync(target, "utf8");
  if (source.includes("agenthub: pdf blob resource support")) return;
  const needlePattern = /                \/\/ Ignore blob resources \(unsupported\)\r?\n                break;/u;
  if (!needlePattern.test(source)) return;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const replacement = [
    "                // agenthub: pdf blob resource support",
    "                if (\"blob\" in chunk.resource && chunk.resource.mimeType === \"application/pdf\" && typeof chunk.resource.blob === \"string\") {",
    "                    const title = (() => {",
    "                        try {",
    "                            const parts = chunk.resource.uri.split(\"/\");",
    "                            return decodeURIComponent(parts[parts.length - 1] || \"attachment.pdf\");",
    "                        }",
    "                        catch {",
    "                            return \"attachment.pdf\";",
    "                        }",
    "                    })();",
    "                    content.push({",
    "                        type: \"document\",",
    "                        source: {",
    "                            type: \"base64\",",
    "                            media_type: chunk.resource.mimeType,",
    "                            data: chunk.resource.blob,",
    "                        },",
    "                        title,",
    "                    });",
    "                }",
    "                break;"
  ].join(newline);
  writeFileSync(target, source.replace(needlePattern, replacement), "utf8");
}

import { cpSync, copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, "..", "..");
const resourcesRoot = join(packageRoot, "package-resources");
const nodeTarget = join(resourcesRoot, "agenthub-node", process.platform === "win32" ? "node.exe" : "node");
const daemonNodeModules = join(resourcesRoot, "agenthub-daemon-node-modules");
const packageJsonByName = new Map();

mkdirSync(dirname(nodeTarget), { recursive: true });
copyFileSync(process.execPath, nodeTarget);

rmSync(daemonNodeModules, { recursive: true, force: true });
copyPackage("better-sqlite3");
copyPackage("bindings", "better-sqlite3");
copyPackage("file-uri-to-path", "bindings");

function copyPackage(name, fromPackage) {
  const packageJsonPath = requireResolve(`${name}/package.json`, fromPackage);
  packageJsonByName.set(name, realpathSync(packageJsonPath));
  const source = realpathSync(dirname(packageJsonPath));
  if (name === "better-sqlite3") ensureBetterSqliteNativeBinding(source);
  const target = join(daemonNodeModules, name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !path.includes(`${name}\\build\\Debug`) && !path.includes(`${name}/build/Debug`)
  });
}

function ensureBetterSqliteNativeBinding(packageDir) {
  const binding = join(packageDir, "build", "Release", "better_sqlite3.node");
  if (existsSync(binding)) return;
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd run build-release"], { cwd: packageDir, stdio: "inherit" });
    return;
  }
  execFileSync("npm", ["run", "build-release"], { cwd: packageDir, stdio: "inherit" });
}

function requireResolve(specifier, fromPackage) {
  if (fromPackage !== undefined) {
    const fromPackageJsonPath = packageJsonByName.get(fromPackage) ?? realpathSync(requireResolve(`${fromPackage}/package.json`));
    return createRequire(fromPackageJsonPath).resolve(specifier);
  }
  const candidates = [
    join(repoRoot, "node_modules", specifier),
    join(packageRoot, "node_modules", specifier)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to locate package resource: ${specifier}`);
}

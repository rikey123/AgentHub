import { build } from "esbuild";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const outRoot = join(repoRoot, "dist", "npm", "agenthub");

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(join(outRoot, "bin"), { recursive: true });
mkdirSync(join(outRoot, "dist"), { recursive: true });
mkdirSync(join(outRoot, "resources"), { recursive: true });

await build({
  entryPoints: [join(repoRoot, "apps", "cli", "src", "index.ts")],
  outfile: join(outRoot, "dist", "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  external: ["better-sqlite3", "keytar"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  }
});

copyResource(join(repoRoot, "apps", "web", "dist"), join(outRoot, "resources", "web"));
copyResource(join(repoRoot, "packages", "db", "migrations"), join(outRoot, "resources", "migrations"));
copyResource(join(repoRoot, "packages", "agents", "templates"), join(outRoot, "resources", "agent-templates"));
copyResource(join(repoRoot, "packages", "orchestrator", "src", "mcp", "room-mcp-stdio.mjs"), join(outRoot, "resources", "room-mcp", "room-mcp-stdio.mjs"));
copyResource(join(repoRoot, "packages", "orchestrator", "src", "mcp", "room-mcp-tools.json"), join(outRoot, "resources", "room-mcp", "room-mcp-tools.json"));

const binPath = join(outRoot, "bin", "agenthub.js");
writeFileSync(binPath, `#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.AGENTHUB_PACKAGE_ROOT ??= resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { runCli } = await import("../dist/cli.mjs");

runCli().then((code) => {
  process.exitCode = code;
}, (error) => {
  const message = error instanceof Error && process.env.AGENTHUB_DEBUG_PHASES === "1"
    ? error.stack ?? error.message
    : error instanceof Error
      ? error.message
      : String(error);
  process.stderr.write(\`\${message}\\n\`);
  process.exitCode = 1;
});
`, "utf8");
chmodSync(binPath, 0o755);

writeFileSync(join(outRoot, "package.json"), `${JSON.stringify({
  name: "agenthub",
  version: rootPackage.version,
  description: "Local-first multi-agent workbench with a web UI and daemon runtime.",
  type: "module",
  license: "UNLICENSED",
  homepage: "https://github.com/rikey123/AgentHub#readme",
  repository: {
    type: "git",
    url: "git+https://github.com/rikey123/AgentHub.git"
  },
  bugs: {
    url: "https://github.com/rikey123/AgentHub/issues"
  },
  bin: {
    agenthub: "bin/agenthub.js"
  },
  files: [
    "bin",
    "dist",
    "resources",
    "README.md"
  ],
  engines: {
    node: rootPackage.engines?.node ?? ">=22.0.0"
  },
  dependencies: {
    "better-sqlite3": "^12.5.0"
  },
  publishConfig: {
    access: "public"
  }
}, null, 2)}\n`, "utf8");

writeFileSync(join(outRoot, "README.md"), `# AgentHub

AgentHub is a local-first multi-agent workbench with a daemon runtime and bundled web UI.

## Install

\`\`\`bash
npm install -g agenthub
agenthub web
\`\`\`

## Commands

- \`agenthub web\` starts the daemon for the current workspace and opens the web UI.
- \`agenthub start\` starts the daemon without opening a browser.
- \`agenthub stop\` stops the daemon.
- \`agenthub status\` checks daemon health.
- \`agenthub doctor\` runs local environment checks.

Requires Node.js 22 or newer.
`, "utf8");

assertPackageFile("dist/cli.mjs");
assertPackageFile("bin/agenthub.js");
assertPackageFile("resources/web/index.html");
assertPackageFile("resources/migrations/0001_init.sql");
assertPackageFile("resources/agent-templates/mock-builder.md");
assertPackageFile("resources/room-mcp/room-mcp-stdio.mjs");
assertPackageFile("resources/room-mcp/room-mcp-tools.json");

process.stdout.write(`npm package prepared at ${outRoot}\n`);

function copyResource(source, target) {
  if (!existsSync(source)) throw new Error(`Missing package resource: ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !path.endsWith(".map")
  });
}

function assertPackageFile(relativePath) {
  const path = join(outRoot, relativePath);
  if (!existsSync(path)) throw new Error(`Missing packaged file: ${relativePath}`);
}

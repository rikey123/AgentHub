import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(packageRoot, "src/daemonSidecarRuntime.ts")],
  outfile: resolve(packageRoot, "dist/daemon-sidecar.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  external: ["better-sqlite3", "keytar", "electron", "electron-updater"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  }
});

import { lineNumberFor, readText, runCheck, walkFiles } from "./lib.mjs";

const bannedApis = ["Bun.serve", "Bun.file", "Bun.spawn", "Bun.write", "Bun.password"];

function parseArgs(argv) {
  const fixtureIndex = argv.indexOf("--fixture");
  return fixtureIndex === -1 ? {} : { fixture: argv[fixtureIndex + 1] };
}

await runCheck("check:bun-api", async function checkBunApi() {
  const { fixture } = parseArgs(process.argv.slice(2));
  const files = fixture ? [fixture.replaceAll("\\", "/")] : [
    ...(await walkFiles("packages/daemon", { extensions: [".ts", ".tsx", ".js", ".mjs"] })),
    ...(await walkFiles("packages/adapters", { extensions: [".ts", ".tsx", ".js", ".mjs"] }))
  ];
  const errors = [];

  for (const file of files) {
    const source = await readText(file);
    for (const api of bannedApis) {
      let index = source.indexOf(api);
      while (index !== -1) {
        errors.push(`Bun-only API '${api}' used in ${file}:${lineNumberFor(source, index)}`);
        index = source.indexOf(api, index + api.length);
      }
    }
  }

  checkBunApi.detail = `${files.length} daemon/adapter file${files.length === 1 ? "" : "s"} scanned`;
  return errors;
});
